import 'dotenv/config';
import { serve } from '@hono/node-server';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { verify } from 'hono/jwt';
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
import adminProduct from './routes/provider/adminProduct.js';
import supportRoutes from './routes/provider/support.js';
import notifications from './routes/provider/notifications.js';
import testimonialsRouter from './routes/provider/testimonials.js';
import adminCategories from './routes/provider/categories.js';
import publicCategories from './routes/provider/publicCategories.js';
import serviceRequestsRoutes from './routes/provider/ServiceRequests.js';
import { logger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';
import adminSettingsRoutes from './routes/provider/settings.js';
import smsResetRoutes from './routes/provider/smsReset.js';
import productSellerProfile from './routes/provider/ProductSellerProfile.js';
import { Readable } from 'stream';

import { eq, and, or, gte, lte, inArray } from 'drizzle-orm';

import * as schema from './drizzle/schema.js';

// JWT payload interface
interface JwtPayload {
  id: string;
  role: string;
}

// Extended WebSocket interface
interface ExtendedWebSocket extends WebSocket {
  isAlive: boolean;
  user?: {
    userId: number;
    role: string;
  };
  ping(data?: any): void;
}
 

const allowedOrigins = [
  'http://localhost:5173',
  'https://marketplace-frontend-delta-nine.vercel.app',
  'https://www.quisells.com',
  'https://quisells.com',
  'wss://mkt-backend-sz2s.onrender.com',
  'ws://mkt-backend-sz2s.onrender.com',
];

const app = new Hono();

// CORS configuration - REMOVE the allowedOrigins declaration from here
app.use('*', async (c, next) => {
  const origin = c.req.header('origin') || '';
  const isAllowed = allowedOrigins.includes(origin);

  // Handle OPTIONS requests (preflight)
  if (c.req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': isAllowed ? origin : allowedOrigins[0],
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PATCH',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  await next();

  // Add CORS headers to all responses
  c.header('Access-Control-Allow-Origin', isAllowed ? origin : allowedOrigins[0]);
  c.header('Access-Control-Allow-Credentials', 'true');
});

app.use('*', logger());
app.use('*', prettyJSON());

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
app.route('/api', serviceRoutes);
app.route('/', profileUploadHandler);
app.route('/api/interests', interestRoutes);
app.route('/api/chat', chat);

// Protected routes
app.route('/api/product', productRoutes);

// Public routes
app.route('/api/products', publicProductRoutes);


app.route('/api/admin/bids', adminBids)
app.route('/api/admin/requests', adminRequests);
app.route('/api/public/categories', publicCategories);

// Mount public provider routes
app.route('/api/provider/public', publicProviderRoutes);
app.route('/api/admin/interests', adminInterestsRoutes);
app.route('/api/client/products', clientProducts);
app.route('/api/admin/product', adminProduct )
app.route('/api/support', supportRoutes);
app.route('/api/notifications', notifications)
app.route('/api/testimonials', testimonialsRouter);
app.route('/api/admin/categories', adminCategories);
app.route('/api/service-requests', serviceRequestsRoutes);
app.route('/api/product-seller', productSellerProfile);
//forgot password routes
app.route('/api/auth', smsResetRoutes);

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
  try {
    const id = parseInt(c.req.param('id'));
    
    if (isNaN(id)) {
      return c.json({ error: 'Invalid college ID' }, 400);
    }

    // Check if college exists
    const existing = await db.query.colleges.findFirst({
      where: eq(schema.colleges.id, id)
    });

    if (!existing) {
      return c.json({ error: 'College not found' }, 404);
    }

    // Check if there are providers referencing this college
    const providers = await db.query.providers.findMany({
      where: eq(schema.providers.collegeId, id)
    });

    if (providers.length > 0) {
      return c.json({ 
        error: 'Cannot delete college',
        message: 'This college has associated providers. Please reassign or delete those providers first.',
        providerCount: providers.length
      }, 409); // 409 Conflict status code
    }

    // If no providers reference this college, proceed with deletion
    await db.delete(schema.colleges).where(eq(schema.colleges.id, id));
    
    return c.json({ 
      success: true,
      message: 'College deleted successfully' 
    });
    
  } catch (error) {
    console.error('Error in college deletion:', error);
    return c.json(
      {
        error: 'Failed to delete college',
        details: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
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

//settings
// Health check route

app.get('/', (c) => {
  return c.json({
    message: 'Marketplace API is running',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// Mount admin settings routes
app.route('/api/admin/settings', adminSettingsRoutes);

// Error handling middleware
app.onError((err, c) => {
  console.error('Application error:', err);
  
  return c.json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong',
    timestamp: new Date().toISOString(),
  }, 500);
});

// 404 handler
app.notFound((c) => {
  return c.json({
    error: 'Not found',
    message: `Route ${c.req.method} ${c.req.path} not found`,
    timestamp: new Date().toISOString(),
  }, 404);
});

// Create HTTP server and WebSocket server
const port = Number(process.env.PORT) || 3000;

// Fix for IncomingMessage vs Request type mismatch
const server = createServer(async (req, res) => {
  try {
    // Convert Node's IncomingMessage to a Request object that Hono expects
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value) {
        headers.set(key, Array.isArray(value) ? value.join(', ') : value);
      }
    }

    // Convert Node's IncomingMessage (req) to a web ReadableStream
    function nodeStreamToWeb(req: IncomingMessage): ReadableStream<Uint8Array> {
      return Readable.toWeb(req) as ReadableStream<Uint8Array>;
    }

    interface NodeRequestInit extends RequestInit {
      duplex?: string;
    }

    const request = new Request(`http://${req.headers.host}${req.url}`, {
      method: req.method,
      headers,
      body: req.method !== 'GET' && req.method !== 'HEAD' ? nodeStreamToWeb(req) : undefined,
      duplex: 'half'
    } as NodeRequestInit);

    // Handle the request with Hono
    const response = await app.fetch(request);

    // Send the response back to the client
    res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    if (response.body) {
      for await (const chunk of response.body) {
        res.write(chunk);
      }
    }
    res.end();
  } catch (err) {
    console.error('Error handling request:', err);
    res.writeHead(500);
    res.end('Internal Server Error');
  }
});

// Create WebSocket server on the same port
const wss = new WebSocketServer({ 
  server,
  // Handle protocol errors gracefully - use the correct signature
  handleProtocols: (protocols: Set<string>, request: IncomingMessage) => {
    if (protocols.has('chat')) return 'chat';
    return false;
  }
});

// Track connections
const connections = new Map<string, ExtendedWebSocket>();

wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
  const extendedWs = ws as ExtendedWebSocket;
  console.log('New WebSocket connection established');
  extendedWs.isAlive = true;

  // Origin validation
  const origin = req.headers.origin;
  const isAllowed = allowedOrigins.includes(origin || '');
  
  if (!isAllowed) {
    console.log('Rejected WebSocket connection from origin:', origin);
    extendedWs.close(1008, 'Origin not allowed');
    return;
  }
 // Send immediate connection acknowledgment
  extendedWs.send(JSON.stringify({
    type: 'connection_established',
    timestamp: Date.now()
  }));

  // Set up authentication timeout (8 seconds)
  const authTimeout = setTimeout(() => {
    if (!extendedWs.user) {
      console.log('WebSocket authentication timeout - closing connection');
      extendedWs.send(JSON.stringify({
        type: 'auth_timeout',
        message: 'Authentication required within 8 seconds'
      }));
      extendedWs.close(1008, 'Authentication timeout');
    }
  }, 8000);

  // Ping/pong for connection health
  extendedWs.on('pong', () => {
    extendedWs.isAlive = true;
  });

  extendedWs.on('message', async (rawMessage: string | Buffer | ArrayBuffer | Buffer[]) => {
    try {
      const message = rawMessage.toString();
      const data = JSON.parse(message);

      /**
       * AUTHENTICATION
       */
      if (data.type === 'auth') {
        const secret = process.env.JWT_SECRET;
        if (!secret) {
          extendedWs.close(1011, 'Server configuration error');
          return;
        }

        try {
          const payload = await verify(data.token, secret) as unknown as JwtPayload;
          if (payload?.id && payload.role) {
            extendedWs.user = {
              userId: parseInt(payload.id),
              role: payload.role
            };
            console.log(`User ${payload.id} authenticated via WebSocket`);

            // Track the connection
            connections.set(payload.id.toString(), extendedWs);

            // Send unread notifications
            const unread = await db
              .select()
              .from(schema.notifications)
              .where(and(
                eq(schema.notifications.userId, parseInt(payload.id)),
                eq(schema.notifications.isRead, false)
              ));

            extendedWs.send(JSON.stringify({
              type: 'initial_notifications',
              data: unread
            }));

            // Send auth confirmation
            extendedWs.send(JSON.stringify({
              type: 'auth_success',
              data: { userId: parseInt(payload.id), role: payload.role }
            }));
          }
        } catch (authError) {
          console.error('JWT verification failed:', authError);
          extendedWs.close(1008, 'Invalid token');
        }
      }

      /**
       * MARK NOTIFICATION AS READ
       */
      if (data.type === 'mark_as_read' && extendedWs.user) {
        const { notificationId } = data;
        try {
          await db
            .update(schema.notifications)
            .set({ isRead: true })
            .where(and(
              eq(schema.notifications.id, notificationId),
              eq(schema.notifications.userId, extendedWs.user.userId)
            ));
          console.log(`Notification ${notificationId} marked as read`);
        } catch (error) {
          console.error('Error marking notification as read:', error);
        }
      }

      /**
       * SUBSCRIBE TO SERVICE REQUESTS
       */
      if (data.type === 'subscribe' && data.channel === 'service_requests') {
        if (extendedWs.user) {
          console.log(`User ${extendedWs.user.userId} subscribed to service requests`);
          // You could track subscriptions in a Map if needed
        }
      }

      /**
       * HANDLE SERVICE REQUEST RESPONSES
       */
      if (data.type === 'service_request_response' && extendedWs.user) {
        const { requestId, action, response } = data;

        const request = await db.query.serviceRequests.findFirst({
          where: eq(schema.serviceRequests.id, requestId),
          with: { client: true }
        });

        if (request) {
          notifyUser(request.clientId, {
            type: 'service_request_response',
            requestId,
            action,
            response,
            providerId: extendedWs.user.userId
          });
        }
      }

      /**
       * HANDLE SERVICE REQUEST MESSAGES
       */
      if (data.type === 'service_request_message' && extendedWs.user) {
        const { requestId, message } = data;

        const request = await db.query.serviceRequests.findFirst({
          where: eq(schema.serviceRequests.id, requestId),
          with: {
            client: true,
            provider: { with: { user: true } }
          }
        });

        if (request) {
          const recipientId = extendedWs.user.userId === request.clientId
            ? request.provider.user.id
            : request.clientId;

          notifyUser(recipientId, {
            type: 'service_request_message',
            requestId,
            message,
            senderId: extendedWs.user.userId
          });
        }
      }

    } catch (err) {
      console.error('WebSocket message error:', err);
    }
  });

 // Connection cleanup
  extendedWs.on('close', () => {
    console.log('WebSocket connection closed');
    clearTimeout(authTimeout);
    if (extendedWs.user) {
      connections.delete(extendedWs.user.userId.toString());
    }
  });

  extendedWs.on('error', (error: Error) => {
    console.error('WebSocket error:', error);
    clearTimeout(authTimeout);
  });


// Initial ping to establish connection
  extendedWs.ping(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
});

// Health monitoring
const interval = setInterval(() => {
  wss.clients.forEach((ws) => {
    const extendedWs = ws as ExtendedWebSocket;
    if (!extendedWs.isAlive) {
      console.log('Terminating unresponsive WebSocket connection');
      extendedWs.terminate();
      return;
    }
    extendedWs.isAlive = false;
    extendedWs.ping(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
  });
}, 30000);

wss.on('close', () => {
  clearInterval(interval);
});

/**
 * Helper to send messages to a specific user
 */
function notifyUser(userId: number, payload: any) {
  const ws = connections.get(userId.toString());
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

/**
 * Exported helpers for external usage
 */
export async function notifyNewServiceRequest(providerId: number, request: any) {
  notifyUser(providerId, {
    type: 'service_request_update',
    data: request
  });
}

export async function notifyServiceRequestUpdate(requestId: number, update: any) {
  const request = await db.query.serviceRequests.findFirst({
    where: eq(schema.serviceRequests.id, requestId),
    with: {
      client: true,
      provider: { with: { user: true } }
    }
  });

  if (request) {
    [request.clientId, request.provider.user.id].forEach(userId => {
      notifyUser(userId, {
        type: 'service_request_update',
        data: { ...request, ...update }
      });
    });
  }
}


// Start the server
server.listen(port, () => {
  console.log(`✅ Server running with WebSocket support on port ${port}`);
});

server.on('error', (err: Error) => {
  console.error('Server error:', err);
});

process.on('unhandledRejection', (err: Error) => {
  console.error('Unhandled rejection:', err);
});