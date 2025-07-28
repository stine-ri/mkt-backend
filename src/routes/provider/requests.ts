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
 const userId = Number(c.get('user').id);
  const { lat, lng, range = 50 } = c.req.query();

  // Get provider profile with services
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

  if (!provider) {
    return c.json({ error: 'Provider profile not found' }, 404);
  }

  // Calculate distance if coordinates provided
  const distanceFilter = lat && lng ? sql`
    (6371 * acos(
      cos(radians(${lat})) * 
      cos(radians(${requests.location}::json->>'lat')) * 
      cos(radians(${requests.location}::json->>'lng') - radians(${lng})) + 
      sin(radians(${lat})) * 
      sin(radians(${requests.location}::json->>'lat'))
    )) <= ${range}
  ` : sql`true`;

    const relevantRequests = await db.query.requests.findMany({
    where: and(
      eq(requests.status, 'open'),
      distanceFilter,
      provider.services.length > 0 
        ? sql`${requests.serviceId} IN (${provider.services.map(s => s.serviceId)})`
        : sql`true`,
      sql`${requests.collegeFilterId} IS NULL OR ${requests.collegeFilterId} = ${provider.collegeId}`
    ),
    with: {
      user: true,
      service: true,
      college: true,
      bids: true, // ✅ Include bids here
    },
  });


  return c.json(relevantRequests);
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