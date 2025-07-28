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
app.get('/', async (c: Context<CustomContext>) => {
  try {
    console.log('=== Provider Requests Route Started ===');

    const user = c.get('user');
    console.log('User object:', user);

    if (!user || !user.id) {
      console.error('No user found in context');
      return c.json({ error: 'Authentication required' }, 401);
    }

    const userId = Number(user.id);
    console.log('User ID:', userId);

    if (isNaN(userId)) {
      console.error('Invalid user ID:', user.id);
      return c.json({ error: 'Invalid user ID' }, 400);
    }

    const { lat, lng, range = 50 } = c.req.query();
    console.log('Query params:', { lat, lng, range });

    if ((lat && !lng) || (!lat && lng)) {
      console.error('Invalid coordinates: lat and lng must be provided together');
      return c.json({ error: 'Both lat and lng are required for location filtering' }, 400);
    }

    const provider = await db.query.providers.findFirst({
      where: eq(providers.userId, userId),
      with: {
        services: {
          with: { service: true }
        }
      }
    });

    console.log('Provider found:', provider ? 'Yes' : 'No');
    if (!provider) {
      return c.json({ error: 'Provider profile not found' }, 404);
    }

    const serviceIds = provider.services.map((s) => s.serviceId);
    console.log('SQL Query parameters:', {
      lat, lng, range, serviceIds, collegeId: provider.collegeId
    });

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
      LEFT JOIN users u ON u.id = r.user_id
      LEFT JOIN services s ON s.id = r.service_id
      LEFT JOIN colleges c ON c.id = r.college_filter_id
      WHERE r.status = 'open'
        AND (
          ${lat && lng ? sql`
            (
              6371 * acos(
                cos(radians(${Number(lat)})) * 
                cos(radians((r.location::json->>'lat')::float)) * 
                cos(radians((r.location::json->>'lng')::float) - radians(${Number(lng)})) + 
                sin(radians(${Number(lat)})) * 
                sin(radians((r.location::json->>'lat')::float))
              )
            ) <= ${Number(range)}
          ` : sql`TRUE`}
        )
        ${serviceIds.length > 0 
          ? sql`AND r.service_id IN (${sql.join(serviceIds.map(id => sql`${id}`), sql`,`)})`
          : sql``}
        AND (
          r.college_filter_id IS NULL OR r.college_filter_id = ${provider.collegeId}
        )
    `);

    console.log('SQL query executed successfully');
    return c.json(results.rows);

  } catch (error: unknown) {
    console.error('=== ERROR in Provider Requests Route ===');

    let message: string | undefined = undefined;

    if (error instanceof Error) {
      console.error('Error type:', error.constructor.name);
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
      if (process.env.NODE_ENV === 'development') {
        message = error.message;
      }
    } else {
      console.error('Non-Error thrown:', error);
    }

    console.error('Context at error:', {
      userId: c.get('user')?.id,
      query: c.req.query(),
      timestamp: new Date().toISOString()
    });

    return c.json({ error: 'Internal server error', message }, 500);
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