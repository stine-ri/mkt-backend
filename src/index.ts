import 'dotenv/config';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { userRouter } from './users/users.router.js';
import { authRouter } from './authentication/auth.router.js';
import providerProfile from './routes/provider/profile.js';
import providerRequests from './routes/provider/requests.js';
import providerBids from './routes/provider/bids.js';
import collegesRoute from './routes/provider/college.js';
import serviceRoutes from './routes/provider/services.js';
import clientRoutes from './routes/provider/client.js';
import { db } from './drizzle/db.js';
import { eq, and, or, gte, lte, inArray } from 'drizzle-orm';
import * as schema from './drizzle/schema.js';

import { WebSocketServer } from 'ws';
import { verify } from 'hono/jwt';
import { registerConnection } from './lib/notification.js';
import { JwtPayload } from './types/context.js'; 
const app = new Hono();

app.get('/', (c) => {
  return c.text('Hello Hono!');
});

app.use(
  cors({
    origin: [
      'http://localhost:5173',
      'https://marketplace-frontend-delta-nine.vercel.app',
    ],
    credentials: true,
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  })
);


const wss = new WebSocketServer({ port: 8080 });

wss.on('connection', (ws, req) => {
  const token = new URL(req.url || '', 'http://localhost').searchParams.get('token');

  if (!token) {
    ws.close();
    return;
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.error('Missing JWT_SECRET');
    ws.close();
    return;
  }

  (async () => {
    try {
      const payload = await verify(token, secret) as JwtPayload;
      registerConnection(Number(payload.id), ws);
      ws.on('message', (message) => {
        // Handle incoming messages if needed
      });
    } catch (error) {
      console.error('WebSocket verification error:', error);
      ws.close();
    }
  })();
});



// routes
app.route('/api', userRouter);
app.route('/api', authRouter);
app.route('/api/provider/profile', providerProfile);
app.route('/api/provider/requests', providerRequests);
app.route('/api/provider/bids', providerBids);
app.route('/api/colleges', collegesRoute);
app.route('api/client', clientRoutes);
app.route('/', serviceRoutes);

// Admin endpoints (existing)
app.get('/api/services', async (c) => {
  const services = await db.query.services.findMany();
  return c.json(services);
});

app.post('/api/services', async (c) => {
  const { name, category } = await c.req.json();
  const [service] = await db.insert(schema.services).values({ name, category }).returning();
  return c.json(service, 201);
});

app.delete('/api/services/:id', async (c) => {
  const id = parseInt(c.req.param('id'));
  await db.delete(schema.services).where(eq(schema.services.id, id));
  return c.json({ message: 'Service deleted' });
});

app.get('/api/colleges', async (c) => {
  const colleges = await db.query.colleges.findMany();
  return c.json(colleges);
});

app.post('/api/colleges', async (c) => {
  const { name, location } = await c.req.json();
  const [college] = await db.insert(schema.colleges).values({ name, location }).returning();
  return c.json(college, 201);
});

app.delete('/api/colleges/:id', async (c) => {
  const id = parseInt(c.req.param('id'));
  await db.delete(schema.colleges).where(eq(schema.colleges.id, id));
  return c.json({ message: 'College deleted' });
});

app.post('/api/service-requests', async (c) => {
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
  const userId = parseInt(c.req.param('userId'));
  const notifications = await db.query.notifications.findMany({
    where: eq(schema.notifications.userId, userId),
    orderBy: (notifications, { desc }) => [desc(notifications.createdAt)],
  });
  
  return c.json(notifications);
});

app.patch('/api/notifications/:id/read', async (c) => {
  const id = parseInt(c.req.param('id'));
  await db.update(schema.notifications)
    .set({ isRead: true })
    .where(eq(schema.notifications.id, id));
  
  return c.json({ message: 'Notification marked as read' });
});



// Health check
app.get('/health', (c) => c.json({ status: 'ok' }));

serve({
  fetch: app.fetch,
  port: Number(process.env.PORT) || 3000,
});

console.log('✅ Server running on http://localhost:3000');
