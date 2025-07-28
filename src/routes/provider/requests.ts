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
    
    const userId = Number(c.get('user').id);
    console.log('User ID:', userId);
    
    const { lat, lng, range = 50 } = c.req.query();
    console.log('Query params:', { lat, lng, range });
    
    // Validate lat/lng if provided
    if ((lat && !lng) || (!lat && lng)) {
      console.error('Invalid coordinates: lat and lng must be provided together');
      return c.json({ error: 'Both lat and lng are required for location filtering' }, 400);
    }

    // Get provider profile with services
    console.log('Fetching provider profile for userId:', userId);
    const provider = await db.query.providers.findFirst({
      where: eq(providers.userId, userId),
      with: {
        services: {
          with: {
            service: true,
          },
        },
      },
    });

    console.log('Provider found:', provider ? 'Yes' : 'No');
    if (provider) {
      console.log('Provider details:', {
        id: provider.id,
        collegeId: provider.collegeId,
        servicesCount: provider.services?.length || 0
      });
    }

    if (!provider) {
      console.log('Provider profile not found, returning 404');
      return c.json({ error: 'Provider profile not found' }, 404);
    }

    // Prepare serviceId list for IN clause
    const serviceIds = provider.services.map((s) => s.serviceId);
    console.log('Service IDs:', serviceIds);

    // Log SQL parameters
    console.log('SQL Query parameters:', {
      lat: lat ? Number(lat) : null,
      lng: lng ? Number(lng) : null,
      range: Number(range),
      serviceIds,
      collegeId: provider.collegeId
    });

    // Raw SQL query using db.execute
    console.log('Executing SQL query...');
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
              cos(radians(${lat}::float)) * 
              cos(radians((r.location::json->>'lat')::float)) * 
              cos(radians((r.location::json->>'lng')::float) - radians(${lng}::float)) + 
              sin(radians(${lat}::float)) * 
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
    console.log('Results count:', results.rows?.length || 0);
    
    // Log first result for debugging (without sensitive data)
    if (results.rows && results.rows.length > 0) {
      const firstResult = results.rows[0];
      console.log('First result sample:', {
        id: firstResult.id,
        service_id: firstResult.service_id,
        status: firstResult.status,
        has_location: !!firstResult.location,
        service_name: firstResult.service_name
      });
    }

    console.log('=== Provider Requests Route Completed Successfully ===');
    return c.json(results.rows);

  } catch (error) {
  console.error('=== ERROR in Provider Requests Route ===');
  if (error instanceof Error) {
    console.error('Error type:', error.constructor.name);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
  } else {
    console.error('Unknown error:', error);
  }
    
    // Log additional context
    console.error('Context at error:', {
      userId: c.get('user')?.id,
      query: c.req.query(),
      timestamp: new Date().toISOString()
    });
    
    return c.json({ 
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' && error instanceof Error ? error.message : undefined

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