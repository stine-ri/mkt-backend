// src/routes/client.ts
import { Hono } from 'hono';
import { eq, and, sql } from 'drizzle-orm';
import { InferSelectModel } from 'drizzle-orm';
import { db } from '../../drizzle/db.js';
import { drizzle } from 'drizzle-orm/node-postgres';

import {
  requests,
  bids,
  services,
  colleges,
  notifications, 
} from '../../drizzle/schema.js';

import { authMiddleware, clientRoleAuth } from '../../middleware/bearAuth.js';

const app = new Hono()
  .use('*', authMiddleware)
  .use('*', clientRoleAuth);

// Infer models
type Request = InferSelectModel<typeof requests>;
type Service = InferSelectModel<typeof services>;
type College = InferSelectModel<typeof colleges>;
type Bid = InferSelectModel<typeof bids>;

type RequestWithRelations = Request & {
  service?: Service;
  college?: College;
  bids?: Bid[];
};

app.get('/requests', async (c) => {
  const user = c.get('user');
  const userId = Number(user.id);

  if (isNaN(userId)) {
    return c.json({ error: 'Invalid user ID' }, 400);
  }

const rawRequests = await db.query.requests.findMany({
  where: eq(requests.userId, userId),
  with: {
    service: true,
    college: true,
    bids: true,
  },
  orderBy: (requests, { desc }) => [desc(requests.createdAt)],
});

const clientRequests: RequestWithRelations[] = rawRequests.map((req) => ({
  ...req,
  service: req.service ?? undefined,
  college: req.college ?? undefined,
  bids: req.bids ?? [],
}));


  const formatted = clientRequests.map((r) => ({
    id: r.id,
    userId: r.userId,
    serviceId: r.serviceId,
    productName: r.productName,
    isService: r.isService,
    description: r.description,
    desiredPrice: r.desiredPrice,
    budget: r.desiredPrice,
    title: r.productName || r.service?.name || '',
    category: r.service?.category || '',
    location: typeof r.location === 'string' ? r.location : JSON.stringify(r.location),
    latitude: null,
    longitude: null,
    serviceName: r.service?.name || '',
    subcategory: null,
    urgency: null,
    preferredTime: null,
    specialRequirements: null,
    notes: null,
    collegeFilterId: r.collegeFilterId,
    college: r.college ? {
      id: r.college.id,
      name: r.college.name,
    } : null,
    status: r.status,
    created_at: r.createdAt,
    bids: r.bids ?? [],
  }));

  return c.json(formatted);
});



// POST /bids - client sends a bid to a provider
// Add this to your bids route file
app.post('/', async (c) => {
  const clientId = Number(c.get('user').id);
  const { providerId, requestId, price, message } = await c.req.json();

  // Validate required fields
  if (!providerId || !requestId || price === undefined) {
    return c.json({ error: 'Missing required fields' }, 400);
  }

  try {
    // Verify the request exists and belongs to the client
    const request = await db.query.requests.findFirst({
      where: and(
        eq(requests.id, requestId),
        eq(requests.userId, clientId)
      ),
    });

    if (!request) {
      return c.json({ error: 'Request not found or unauthorized' }, 404);
    }

    // Create the bid
    const [newBid] = await db.insert(bids).values({
      providerId: Number(providerId),
      requestId: Number(requestId),
      price: Number(price),
      message: message || null,
      status: 'pending',
      isGraduateOfRequestedCollege: false, // Default value
      createdAt: new Date()
    }).returning();

    // Send notification to provider
    await db.insert(notifications).values({
      userId: providerId,
      type: 'new_bid',
      message: `You have a new bid for request #${requestId}`,
      isRead: false,
      relatedEntityId: newBid.id,
      createdAt: new Date()
    });

    return c.json(newBid, 201);
  } catch (error) {
    console.error('Error creating bid:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// Get detailed bids for a specific request
app.get('/requests/:id/bids', async (c) => {
  const userId = Number(c.get('user').id); // ✅ Convert string to number
  const requestId = parseInt(c.req.param('id'), 10); // ✅ Make sure it's a number

  if (isNaN(userId) || isNaN(requestId)) {
    return c.json({ error: 'Invalid user or request ID' }, 400);
  }

  // ✅ Verify request ownership
  const request = await db.query.requests.findFirst({
    where: and(
      eq(requests.id, requestId),
      eq(requests.userId, userId) // ✅ Now both sides are numbers
    )
  });

  if (!request) {
    return c.json({ error: 'Request not found or unauthorized' }, 404);
  }

  const requestBids = await db.query.bids.findMany({
    where: eq(bids.requestId, requestId),
    with: {
      provider: {
        with: {
          user: true,
        },
      },
    },
    orderBy: (bids, { asc }) => [asc(bids.createdAt)],
  });

  return c.json(requestBids);
});


// Accept a bid with enhanced validation
app.post('/bids/:id/accept', async (c) => {
  try {
    const userId = Number(c.get('user')?.id);
    const bidId = parseInt(c.req.param('id'), 10);
    
    if (isNaN(userId) || isNaN(bidId)) {
      return c.json({ error: 'Invalid user or bid ID' }, 400);
    }

    // 1. First verify the bid and request
    const bidWithRequest = await db.query.bids.findFirst({
      where: eq(bids.id, bidId),
      with: { request: true },
    });

    if (!bidWithRequest || !bidWithRequest.request) {
      return c.json({ error: 'Bid not found or unauthorized' }, 404);
    }

    if (bidWithRequest.request.userId !== userId) {  // Note: user_id instead of userId
      return c.json({ error: 'Unauthorized' }, 403);
    }

    if (bidWithRequest.request.status !== 'open') {
      return c.json({ error: 'Request is no longer open' }, 400);
    }

    // 2. Execute updates sequentially
    await db.update(bids)
      .set({ status: 'accepted' })
      .where(eq(bids.id, bidId));

    await db.update(requests)
      .set({ 
        status: 'closed',
        accepted_bid_id: bidId  // Changed to snake_case
      })
      .where(eq(requests.id, bidWithRequest.request.id));

    await db.update(bids)
      .set({ status: 'rejected' })
      .where(
        and(
          eq(bids.requestId, bidWithRequest.request.id),  // Note: request_id instead of requestId
          eq(bids.status, 'pending')
        )
      );

    // 3. Create notifications - ensure all required fields are included
    if (!bidWithRequest.providerId) {  // Note: provider_id instead of providerId
      throw new Error('Provider ID is missing');
    }

    const notificationData = [
      {
        userId: bidWithRequest.providerId,  // Note: user_id instead of userId
        type: 'bid_accepted',
        message: `Your bid for request #${bidWithRequest.request.id} was accepted!`,
        related_entity_id: bidId,  // Note: related_entity_id instead of relatedEntityId
        isRead: false,  // Assuming this is required
        createdAt: new Date()  // Assuming this is required
      },
      {
        userId: userId,
        type: 'bid_accepted_confirmation',
        message: `You accepted a bid from provider #${bidWithRequest.providerId}`,
        relatedEntityId: bidWithRequest.request.id,
        isRead: false,
        createdAt: new Date()
      },
    ];
    
    await db.insert(notifications).values(notificationData);

    return c.json({ success: true });
    
  } catch (error) {
    console.error('Error accepting bid:', error);
    return c.json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

// Notification endpoints
app.get('/notifications', async (c) => {
  const userId = Number(c.get('user').id);

  const userNotifications = await db.query.notifications.findMany({
    where: eq(notifications.userId, userId),
    orderBy: (n, { desc }) => [desc(n.createdAt)],
    limit: 50
  });

  return c.json(userNotifications);
});


app.patch('/notifications/:id/read', async (c) => {
  const userId = Number(c.get('user').id);
  const notificationId = parseInt(c.req.param('id'));

  await db.update(notifications)
    .set({ isRead: true })
    .where(
      and(
        eq(notifications.id, notificationId),
        eq(notifications.userId, userId)
      )
    );

  return c.json({ success: true });
});



app.post('/requests', async (c) => {
  const userId = Number(c.get('user').id);
  const body = await c.req.json();

  if (body.isService && !body.serviceId) {
    return c.json({ error: 'Service ID is required' }, 400);
  }

  if (!body.isService && !body.productName) {
    return c.json({ error: 'Product name is required' }, 400);
  }

  const [request] = await db.insert(requests).values({
    userId,
    serviceId: body.isService ? Number(body.serviceId) : null,
    productName: !body.isService ? body.productName : null,
    isService: Boolean(body.isService),
    description: body.description,
    desiredPrice: Number(body.desiredPrice),
    location: body.location,
    collegeFilterId: body.collegeFilterId ? Number(body.collegeFilterId) : null,
    status: 'open',
  }).returning();

  return c.json(request);
});

export default app;