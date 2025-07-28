import { Hono } from 'hono';
import type { Context } from 'hono';
import { db } from '../../drizzle/db.js';
import { bids, requests, providers , users} from '../../drizzle/schema.js';
import { eq, and } from 'drizzle-orm';
import { authMiddleware, serviceProviderRoleAuth } from '../../middleware/bearAuth.js';
import type { CustomContext } from '../../types/context.js';
import { sendRealTimeNotification } from '../../websocket.js';

const app = new Hono<CustomContext>();

app.use('*', authMiddleware, serviceProviderRoleAuth);

// Get provider's bids

app.get('/', async (c: Context<CustomContext>) => {
  const user = c.get('user'); // JwtPayload
    const userId = Number(user.id);

  const provider = await db.query.providers.findFirst({
    where: eq(providers.userId, userId),
  });

  if (!provider) {
    return c.json({ error: 'Provider profile not found' }, 404);
  }

  const providerBids = await db.query.bids.findMany({
    where: eq(bids.providerId, provider.id),
    with: {
      request: {
        with: {
          user: true,
          service: true,
        },
      },
    },
  });

  return c.json(providerBids);
});

// Place a new bid
app.post('/', async (c) => {
  const userId = Number(c.get('user').id); // Ensure it's a number

  const { requestId, price, message } = await c.req.json();

  const provider = await db.query.providers.findFirst({
    where: eq(providers.userId, userId),
  });

  if (!provider) {
    return c.json({ error: 'Provider profile not found' }, 404);
  }

  const request = await db.query.requests.findFirst({
    where: eq(requests.id, requestId),
  });

  if (!request) {
    return c.json({ error: 'Request not found' }, 404);
  }

  const isGraduateOfRequestedCollege = request.collegeFilterId 
    ? request.collegeFilterId === provider.collegeId
    : false;

  const [bid] = await db.insert(bids).values({
    requestId,
    providerId: provider.id,
    price,
    message,
    isGraduateOfRequestedCollege,
  }).returning();

// Send WebSocket notification
const wsMessage = {
  type: 'new_bid',
  requestId: bid.requestId,
  bid: {
    ...bid,
    provider: { // Include provider info
      firstName: provider.firstName,
      lastName: provider.lastName
    }
  }
};

// Send to client's WebSocket connection
sendRealTimeNotification(Number(request.userId), wsMessage);



  return c.json(bid, 201);
});
// Add to your bids route file
app.post('/:id/accept', async (c) => {
  const bidId = Number(c.req.param('id'));

  try {
    // Update bid status
    const [updatedBid] = await db.update(bids)
      .set({ status: 'accepted' })
      .where(eq(bids.id, bidId))
      .returning();

    if (!updatedBid) {
      return c.json({ error: 'Bid not found' }, 404);
    }

    // Update request status and get the updated request
    const [updatedRequest] = await db.update(requests)
      .set({ status: 'closed' })
      .where(eq(requests.id, updatedBid.requestId))
      .returning();

    if (!updatedRequest) {
      return c.json({ error: 'Request not found' }, 404);
    }

    // Notify the client (owner of the request)
    sendRealTimeNotification(Number(updatedRequest.userId), {
      type: 'bid_accepted',
      requestId: updatedRequest.id,
      bid: updatedBid,
    });

    // Notify the provider (owner of the accepted bid)
    sendRealTimeNotification(Number(updatedBid.providerId), {
      type: 'your_bid_accepted',
      requestId: updatedRequest.id,
      bid: updatedBid,
    });

    return c.json({
      bid: updatedBid,
      request: updatedRequest,
    });
  } catch (error) {
    console.error('Error accepting bid:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});


// getting a service provider bids
app.get('/bids', async (c) => {
  const providerId = Number(c.get('user').id);

 const providerBids = await db.query.bids.findMany({
  where: eq(bids.providerId, providerId),
  with: {
    provider: {
      with: {
        user: true,
      },
    },
    request: true, // if needed
  },
});

  return c.json(providerBids);
});

app.post('/:id/reject', async (c) => {
  const bidId = Number(c.req.param('id'));

  try {
    const [updatedBid] = await db.update(bids)
      .set({ status: 'rejected' })
      .where(eq(bids.id, bidId))
      .returning();

    if (!updatedBid) {
      return c.json({ error: 'Bid not found' }, 404);
    }

    // Optional: Notify the provider or client via WebSocket
    const wsMessage = {
      type: 'bid_rejected',
      bid: updatedBid
    };
    sendRealTimeNotification(Number(updatedBid.providerId), wsMessage);

    return c.json({ bid: updatedBid });
  } catch (error) {
    console.error('Error rejecting bid:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

export default app;