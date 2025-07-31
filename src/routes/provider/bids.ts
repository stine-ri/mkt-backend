import { Hono } from 'hono';
import type { Context } from 'hono';
import { db } from '../../drizzle/db.js';
import { bids, requests, providers , users} from '../../drizzle/schema.js';
import { eq, and, ne } from 'drizzle-orm';
import { authMiddleware, serviceProviderRoleAuth } from '../../middleware/bearAuth.js';
import type { CustomContext } from '../../types/context.js';
import { sendRealTimeNotification } from '../../websocket.js';

const app = new Hono<CustomContext>();

app.use('*', authMiddleware, serviceProviderRoleAuth);

// Get provider's bids

app.get('/', async (c: Context<CustomContext>) => {
  const user = c.get('user'); // JwtPayload
  const userId = Number(user.id);

  if (user.role === 'admin') {
    // Admin: Fetch all bids
    const allBids = await db.query.bids.findMany({
      with: {
        provider: {
          with: {
            user: true, // Optional: if you want provider's user info
          },
        },
        request: {
          with: {
            user: true,
            service: true,
          },
        },
      },
    });

    return c.json(allBids);
  }

  // For service provider: Get provider profile first
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
  const userId = Number(c.get('user').id);

  try {
    // First get the bid to find its associated request and provider
    const bid = await db.query.bids.findFirst({
      where: eq(bids.id, bidId),
      with: {
        provider: true,
        request: true
      }
    });

    if (!bid) {
      return c.json({ error: 'Bid not found' }, 404);
    }

    // Verify the request exists and belongs to this user
    if (!bid.request || bid.request.userId !== userId) {
      return c.json({ error: 'Request not found or unauthorized' }, 404);
    }

    if (bid.status !== 'pending') {
      return c.json({ error: 'Bid is not in a pending state' }, 400);
    }

    if (bid.request.status === 'closed') {
      return c.json({ error: 'Request is already closed' }, 400);
    }

    // Update bid status to accepted
    const [updatedBid] = await db.update(bids)
      .set({ status: 'accepted' })
      .where(eq(bids.id, bidId))
      .returning();

    // Update request status and set accepted_bid_id
    const [updatedRequest] = await db.update(requests)
      .set({ 
        status: 'closed',
        accepted_bid_id: bidId
      })
      .where(eq(requests.id, bid.requestId))
      .returning();

    // Reject all other pending bids for this request
    await db.update(bids)
      .set({ status: 'rejected' })
      .where(
        and(
          eq(bids.requestId, bid.requestId),
          eq(bids.status, 'pending'),
          ne(bids.id, bidId) // Exclude the accepted bid
        )
      );

    // Notifications
    const notificationPayload = {
      type: 'bid_accepted',
      requestId: updatedRequest.id,
      bid: {
        ...updatedBid,
        provider: bid.provider
      },
      request: updatedRequest
    };

    // Notify client (request owner)
    if (updatedRequest.userId) {
      sendRealTimeNotification(
        Number(updatedRequest.userId),
        notificationPayload
      );
    }

    // Notify provider (bid owner)
    if (updatedBid.providerId) {
      sendRealTimeNotification(
        Number(updatedBid.providerId),
        {
          ...notificationPayload,
          type: 'your_bid_accepted'
        }
      );
    }

    return c.json({
      bid: updatedBid,
      request: updatedRequest,
    });

  } catch (error) {
    console.error('Error accepting bid:', error);
    
    // Attempt to revert any changes if possible
    try {
      // You could add logic here to revert changes if needed
    } catch (revertError) {
      console.error('Error reverting changes:', revertError);
    }
    
    return c.json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
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