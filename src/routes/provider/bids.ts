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
        provider: true, // Include provider info for notification
        request: true   // Include request info
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

    // Since transactions aren't supported, we'll do operations sequentially
    // with error recovery if needed

    // Step 1: Update bid status to accepted
    const [updatedBid] = await db.update(bids)
      .set({ status: 'accepted' })
      .where(eq(bids.id, bidId))
      .returning();

    if (!updatedBid) {
      return c.json({ error: 'Failed to update bid status' }, 500);
    }

    // Step 2: Update request status and set accepted_bid_id
    let updatedRequest;
    try {
      [updatedRequest] = await db.update(requests)
        .set({ 
          status: 'closed',
          accepted_bid_id: bidId
        })
        .where(eq(requests.id, bid.requestId))
        .returning();

      if (!updatedRequest) {
        // Rollback: revert bid status if request update failed
        await db.update(bids)
          .set({ status: 'pending' })
          .where(eq(bids.id, bidId));
        
        return c.json({ error: 'Failed to update request status' }, 500);
      }
    } catch (requestUpdateError) {
      // Rollback: revert bid status
      await db.update(bids)
        .set({ status: 'pending' })
        .where(eq(bids.id, bidId));
      
      throw requestUpdateError;
    }

    // Step 3: Reject all other pending bids for this request
    try {
      await db.update(bids)
        .set({ status: 'rejected' })
        .where(
          and(
            eq(bids.requestId, bid.requestId),
            eq(bids.status, 'pending'),
            ne(bids.id, bidId) // Exclude the accepted bid
          )
        );
    } catch (rejectBidsError) {
      console.warn('Warning: Failed to reject other bids, but main operation succeeded:', rejectBidsError);
      // Don't fail the entire operation if this step fails
      // The main bid acceptance is complete
    }

    // Notifications
    const notificationPayload = {
      type: 'bid_accepted',
      requestId: updatedRequest.id,
      bid: {
        ...updatedBid,
        provider: bid.provider // Include provider details
      },
      request: updatedRequest
    };

    // Notify client (request owner) - don't fail if notifications fail
    try {
      if (updatedRequest.userId) {
        sendRealTimeNotification(
          Number(updatedRequest.userId),
          notificationPayload
        );
      }
    } catch (notificationError) {
      console.warn('Warning: Failed to send notification to client:', notificationError);
    }

    // Notify provider (bid owner) - don't fail if notifications fail
    try {
      if (updatedBid.providerId) {
        sendRealTimeNotification(
          Number(updatedBid.providerId),
          {
            ...notificationPayload,
            type: 'your_bid_accepted'
          }
        );
      }
    } catch (notificationError) {
      console.warn('Warning: Failed to send notification to provider:', notificationError);
    }

    return c.json({
      bid: updatedBid,
      request: updatedRequest,
    });

  } catch (error) {
    console.error('Error accepting bid:', error);
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