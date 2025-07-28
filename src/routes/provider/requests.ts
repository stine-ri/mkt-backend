import { Hono } from 'hono';
import type { Context } from 'hono';
import { db } from '../../drizzle/db.js';
import { requests, providers, colleges, bids, notifications } from '../../drizzle/schema.js';
import { eq, and, lte, gte, sql } from 'drizzle-orm';
import {authMiddleware, serviceProviderRoleAuth  } from '../../middleware/bearAuth.js';
import type { CustomContext } from '../../types/context.js';
import { notifyNearbyProviders } from '../../lib/providerNotifications.js';

const app = new Hono<CustomContext>();


app.use('*', authMiddleware, serviceProviderRoleAuth);

// Get relevant requests for provider
// Quick fix - replace your existing route with this simpler version
// Quick fix - replace your existing route with this simpler version
app.get('/', async (c: Context<CustomContext>) => {
  try {
    const userId = Number(c.get('user').id);
    const { lat, lng, range = '50' } = c.req.query();

    // Get provider profile with services
    const provider = await db.query.providers.findFirst({
      where: eq(providers.userId, userId),
      with: {
        services: {
          with: { service: true }
        }
      }
    });

    if (!provider) {
      return c.json({ error: 'Provider profile not found' }, 404);
    }

    const serviceIds = provider.services.map((s) => s.serviceId);

    // If no coordinates provided, skip location filtering
    if (!lat || !lng) {
      const results = await db.execute(sql`
        SELECT 
          r.*, 
          u.email AS user_email, u.role AS user_role,
          s.name AS service_name,
          c.name AS college_name,
          (
            SELECT json_agg(b.*) FROM bids b WHERE b.request_id = r.id
          ) AS bids
        FROM requests r
        LEFT JOIN users u ON u.user_id = r.user_id
        LEFT JOIN services s ON s.id = r.service_id
        LEFT JOIN colleges c ON c.id = r.college_filter_id
        WHERE r.status = 'open'
          ${serviceIds.length > 0 
            ? sql`AND r.service_id IN (${sql.join(serviceIds.map(id => sql`${id}`), sql`,`)})`
            : sql``}
          AND (
            r.college_filter_id IS NULL OR r.college_filter_id = ${provider.collegeId}
          )
      `);
      return c.json(results.rows);
    }

    // With coordinates - convert to numbers first
    const numLat = parseFloat(lat);
    const numLng = parseFloat(lng);
    const numRange = parseFloat(range);

    // Validate coordinates
    if (isNaN(numLat) || isNaN(numLng) || isNaN(numRange)) {
      return c.json({ error: 'Invalid coordinate values' }, 400);
    }

    const results = await db.execute(sql`
      SELECT 
        r.*, 
        u.email AS user_email, u.role AS user_role,
        s.name AS service_name,
        c.name AS college_name,
        (
          SELECT json_agg(b.*) FROM bids b WHERE b.request_id = r.id
        ) AS bids
      FROM requests r
      LEFT JOIN users u ON u.user_id = r.user_id
      LEFT JOIN services s ON s.id = r.service_id
      LEFT JOIN colleges c ON c.id = r.college_filter_id
      WHERE r.status = 'open'
        AND (
          6371 * acos(
            cos(radians(${numLat})) * 
            cos(radians((r.location::json->>'lat')::float)) * 
            cos(radians((r.location::json->>'lng')::float) - radians(${numLng})) + 
            sin(radians(${numLat})) * 
            sin(radians((r.location::json->>'lat')::float))
          )
        ) <= ${numRange}
        ${serviceIds.length > 0 
          ? sql`AND r.service_id IN (${sql.join(serviceIds.map(id => sql`${id}`), sql`,`)})`
          : sql``}
        AND (
          r.college_filter_id IS NULL OR r.college_filter_id = ${provider.collegeId}
        )
    `);

    return c.json(results.rows);

  } catch (error: unknown) {
  console.error('Provider requests error:', error);

  let errorMessage: string | undefined = undefined;
  if (process.env.NODE_ENV === 'development' && error instanceof Error) {
    errorMessage = error.message;
  }

  return c.json({ 
    error: 'Internal server error',
    message: errorMessage
  }, 500);
}
});



app.post('/', async (c) => {
  const userId = Number(c.get('user').id);
  const body = await c.req.json();

  // Validate request
  if (body.isService && !body.serviceId) {
    return c.json({ error: 'Service ID is required' }, 400);
  }
  if (!body.isService && !body.productName) {
    return c.json({ error: 'Product name is required' }, 400);
  }

  // Create request
  const [request] = await db.insert(requests).values({
    userId: userId,
    serviceId: body.isService ? Number(body.serviceId) : null,
    productName: !body.isService ? body.productName : null,
    isService: Boolean(body.isService),
    description: body.description,
    desiredPrice: Number(body.desiredPrice),
    location: body.location, // This should be a string matching your varchar(255) column
    collegeFilterId: body.collegeFilterId ? Number(body.collegeFilterId) : null,
    status: 'open'
  }).returning();

  // Notify providers
  await notifyNearbyProviders(request);

  return c.json(request);
});

export default app;