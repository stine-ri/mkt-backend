import 'dotenv/config';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { userRouter } from './users/users.router.js';
import { authRouter } from './authentication/auth.router.js';
import { serveStatic } from '@hono/node-server/serve-static';
import providerProfile from './routes/provider/profile.js';
import providerRequests from './routes/provider/requests.js';
import providerBids from './routes/provider/bids.js';
import collegesRoute from './routes/provider/college.js';
import serviceRoutes from './routes/provider/services.js';
import clientRoutes from './routes/provider/client.js';
import profileUploadHandler from './routes/provider/profile.js';
import { authMiddleware } from './middleware/bearAuth.js';
import interestRoutes from './routes/provider/interests.js'
import { db } from './drizzle/db.js';
import publicProviderRoutes from './routes/provider/publicProvider.js';
import chat from './services/chat.js';
import productRoutes from './routes/provider/product.js';
import publicProductRoutes from './routes/provider/publicProducts.js';
import adminBids from './routes/provider/adminBids.js'
import adminRequests from './routes/provider/requests.js';
import adminInterestsRoutes from './routes/provider/adminInterests.js';
import clientProducts from './routes/provider/clientProduct.js';
import adminProduct from './routes/provider/adminProduct.js'
import { eq, and, or, gte, lte, inArray } from 'drizzle-orm';

import * as schema from './drizzle/schema.js';
import './websocket.js';
 
const app = new Hono();

// CORS configuration
app.use(
  cors({
    origin: [
      'http://localhost:5173',
      'https://marketplace-frontend-delta-nine.vercel.app',
    ],
    credentials: true,
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  })
);

// Serve static files from uploads directory
app.use('/uploads/*', serveStatic({ 
  root: './',
  rewriteRequestPath: (path) => path 
}));

// PUBLIC ROUTES (before auth middleware) - EXACT PATHS ONLY
app.get('/', (c) => {
  return c.text('Hello Hono!');
});

app.get('/health', (c) => c.json({ status: 'ok' }));

// Public provider routes
app.get('/public/all', async (c) => {
  console.log('Public route: /public/all accessed');
  try {
    const results = await db.select()
      .from(schema.providers)
      .leftJoin(schema.providerServices, eq(schema.providers.id, schema.providerServices.providerId))
      .leftJoin(schema.services, eq(schema.providerServices.serviceId, schema.services.id))
      .leftJoin(schema.colleges, eq(schema.providers.collegeId, schema.colleges.id))
      .where(eq(schema.providers.isProfileComplete, true));

    const providersMap = new Map<number, any>();
    
    results.forEach(row => {
      const provider = row.providers;
      const service = row.services;
      const college = row.colleges;

      if (!providersMap.has(provider.id)) {
        providersMap.set(provider.id, {
          ...provider,
          college: college || null,
          services: service ? [service] : [],
          rating: provider.rating || null,
          completedRequests: provider.completedRequests || 0
        });
      } else {
        const existing = providersMap.get(provider.id);
        if (service && !existing.services.some((s: any) => s.id === service.id)) {
          existing.services.push(service);
        }
      }
    });

    return c.json({
      success: true,
      data: Array.from(providersMap.values())
    });
  } catch (error) {
    console.error('Error fetching providers:', error);
    return c.json({
      success: false,
      error: 'Failed to fetch providers',
      details: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});

app.get('/public/:id', async (c) => {
  console.log('Public route: /public/:id accessed');
  try {
    const providerId = parseInt(c.req.param('id'));

    const provider = await db.query.providers.findFirst({
      where: and(
        eq(schema.providers.id, providerId),
        eq(schema.providers.isProfileComplete, true)
      ),
      with: {
        college: true,
        services: {
          with: {
            service: true,
          },
        },
      },
    });

    if (!provider) {
      return c.json({
        success: false,
        error: 'Provider not found or profile incomplete'
      }, 404);
    }

    return c.json({
      success: true,
      data: {
        id: provider.id,
        firstName: provider.firstName,
        lastName: provider.lastName,
        college: provider.college,
        services: provider.services.map(ps => ps.service),
        rating: provider.rating,
        completedRequests: provider.completedRequests,
        profileImageUrl: provider.profileImageUrl,
        bio: provider.bio
      }
    });
  } catch (error) {
    console.error('Error fetching provider:', error);
    return c.json({
      success: false,
      error: 'Failed to fetch provider',
      details: error instanceof Error ? error.message : String(error)
    }, 500);
  }
});

// Public admin endpoints (READ ONLY)
app.get('/api/services', async (c) => {
  console.log('Public route: /api/services accessed');
  const services = await db.query.services.findMany();
  return c.json(services);
});

app.get('/api/colleges', async (c) => {
  console.log('Public route: /api/colleges accessed');
  const colleges = await db.query.colleges.findMany();
  return c.json(colleges);
});

// Apply auth middleware globally (with public route exclusions)
console.log('Applying global auth middleware...');
app.use('*', authMiddleware);

// PROTECTED ROUTES (after auth middleware)
console.log('Setting up protected routes...');

// Route handlers
app.route('/api', userRouter);
app.route('/api', authRouter);
app.route('/api/provider/profile', providerProfile);
app.route('/api/provider/requests', providerRequests);
app.route('/api/provider/bids', providerBids);
app.route('/api/colleges', collegesRoute);
app.route('/api/client', clientRoutes);  
app.route('/', serviceRoutes);
app.route('/', profileUploadHandler);
app.route('/api/interests', interestRoutes);
app.route('/api/chat', chat);

// Protected routes
app.route('/api/product', productRoutes);

// Public routes
app.route('/api/products', publicProductRoutes);

app.route('/api/admin/bids', adminBids)
app.route('/api/admin/requests', adminRequests);
// Mount public provider routes
app.route('/api/provider/public', publicProviderRoutes);
app.route('/api/admin/interests', adminInterestsRoutes);
app.route('/api/client/products', clientProducts);
app.route('/api/admin/product', adminProduct )

// PROTECTED Admin endpoints (CREATE/UPDATE/DELETE operations)
app.post('/api/services', async (c) => {
  console.log('Protected route: POST /api/services accessed');
  const { name, category } = await c.req.json();
  const [service] = await db.insert(schema.services).values({ name, category }).returning();
  return c.json(service, 201);
});

app.delete('/api/services/:id', async (c) => {
  console.log('Protected route: DELETE /api/services/:id accessed');
  const id = parseInt(c.req.param('id'));
  await db.delete(schema.services).where(eq(schema.services.id, id));
  return c.json({ message: 'Service deleted' });
});

app.post('/api/colleges', async (c) => {
  console.log('Protected route: POST /api/colleges accessed');
  const { name, location } = await c.req.json();
  const [college] = await db.insert(schema.colleges).values({ name, location }).returning();
  return c.json(college, 201);
});

app.delete('/api/colleges/:id', async (c) => {
  console.log('Protected route: DELETE /api/colleges/:id accessed');
  const id = parseInt(c.req.param('id'));
  await db.delete(schema.colleges).where(eq(schema.colleges.id, id));
  return c.json({ message: 'College deleted' });
});

app.post('/api/service-requests', async (c) => {
  console.log('Protected route: POST /api/service-requests accessed');
  const requestData = await c.req.json();

  // Create the request
  const [request] = await db.insert(schema.requests)
    .values(requestData)
    .returning();

  // Find all providers offering the requested service
  const matchingProviderServices = await db
    .select({ providerId: schema.providerServices.providerId })
    .from(schema.providerServices)
    .where(eq(schema.providerServices.serviceId, requestData.serviceId));

  const providerIds = matchingProviderServices.map(p => p.providerId);

  // Now query providers with optional college filter
  let providerQuery = db
    .select()
    .from(schema.providers)
    .where(inArray(schema.providers.id, providerIds));

  if (requestData.collegeFilter) {
    providerQuery = db
      .select()
      .from(schema.providers)
      .where(
        and(
          inArray(schema.providers.id, providerIds),
          eq(schema.providers.collegeId, requestData.collegeFilter)
        )
      );
  }

  const providers = await providerQuery;

  // Create notifications for matching providers
  if (providers.length > 0) {
    const notificationValues = providers.map((provider) => ({
      userId: provider.userId,
      type: 'new_request',
      message: `New service request in your area`,
      relatedEntityId: request.id,
    }));

    await db.insert(schema.notifications).values(notificationValues);
  }

  return c.json(request, 201);
});

app.get('/api/service-requests/nearby', async (c) => {
  console.log('Protected route: GET /api/service-requests/nearby accessed');
  const { latitude, longitude, radius, providerId } = c.req.query();
  
  const results = await db.query.requests.findMany({
    where: (req) => eq(req.status, 'pending'),
    with: {
      service: true,
      college: true,
      user: true,
    },
  });

  return c.json(results);
});

app.post('/api/bids', async (c) => {
  console.log('Protected route: POST /api/bids accessed');
  const bidData = await c.req.json();
  const [bid] = await db.insert(schema.bids).values(bidData).returning();
  
  // Notify client
  await db.insert(schema.notifications).values({
    userId: bidData.clientId,
    type: 'new_bid',
    message: `New bid received for your request`,
    relatedEntityId: bid.requestId,
  });
  
  return c.json(bid, 201);
});

app.get('/api/notifications/:userId', async (c) => {
  console.log('Protected route: GET /api/notifications/:userId accessed');
  const userId = parseInt(c.req.param('userId'));
  const notifications = await db.query.notifications.findMany({
    where: eq(schema.notifications.userId, userId),
    orderBy: (notifications, { desc }) => [desc(notifications.createdAt)],
  });
  
  return c.json(notifications);
});

app.patch('/api/notifications/:id/read', async (c) => {
  console.log('Protected route: PATCH /api/notifications/:id/read accessed');
  const id = parseInt(c.req.param('id'));
  await db.update(schema.notifications)
    .set({ isRead: true })
    .where(eq(schema.notifications.id, id));
  
  return c.json({ message: 'Notification marked as read' });
});

serve({
  fetch: app.fetch,
  port: Number(process.env.PORT) || 3000,
});

console.log('✅ Server running on http://localhost:3000');