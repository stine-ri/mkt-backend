// services/interests.ts
import { Hono } from 'hono';
import { db } from '../../drizzle/db.js';
import { interests, requests, providers, users,  chatRooms, messages } from '../../drizzle/schema.js';
import { eq, and, count, exists, or } from 'drizzle-orm';
import type { CustomContext } from '../../types/context.js';
import { notifyUser } from '../../lib/notification.js';
import {  sendRealTimeNotification} from '../../websocket.js';

const app = new Hono<CustomContext>();

// Express interest with enhanced validation
app.post('/:requestId', async (c) => {
  try {
    const requestId = Number(c.req.param('requestId'));
    const user = c.get('user');

    // Verify provider exists with more details
    const provider = await db.query.providers.findFirst({
      where: eq(providers.userId, Number(user.id)),
      with: {
        user: true // Include user details for notification
      }
    });

    if (!provider) {
      return c.json({ 
        error: "Provider profile not found",
        solution: "Please complete your provider profile first",
        docs: "/docs/providers/setup" // Add helpful links
      }, 404);
    }

    // Check request with more details
    const request = await db.query.requests.findFirst({
      where: and(
        eq(requests.id, requestId),
        eq(requests.allowInterests, true)
      ),
      with: {
        user: true // Include client for notification
      }
    });

    if (!request) {
      return c.json({ 
        error: "Request not available",
        details: {
          possibleReasons: [
            "Request closed",
            "Doesn't accept interests",
            "Doesn't exist"
          ]
        }
      }, 404);
    }

    // Check existing interest
    const existingInterest = await db.query.interests.findFirst({
      where: and(
        eq(interests.requestId, requestId),
        eq(interests.providerId, provider.id)
      )
    });

    if (existingInterest) {
      return c.json({ 
        error: "Interest already exists",
        existingInterest: {
          id: existingInterest.id,
          createdAt: existingInterest.createdAt
        },
        action: "Consider withdrawing the existing interest first"
      }, 409);
    }

    // Create interest
    const [newInterest] = await db.insert(interests).values({
      requestId,
      providerId: provider.id,
      createdAt: new Date(),
      status: 'pending' // Add status field
    }).returning();

    // Notify client
if (request.user) {
  const savedNotification = await notifyUser(request.user.id, {
    userId: request.user.id,
    type: 'new_interest',
    message: `${provider.user?.full_name || 'A provider'} showed interest in your request.`,
    relatedEntityId: request.id // or requestId if that's your intended use
  });

  // ✅ Send via WebSocket using imported helper
  sendRealTimeNotification(request.user.id, {
    ...savedNotification,
    provider: {
      id: provider.id,
      name: provider.user?.full_name || 'Provider',
      avatar: provider.user?.avatar || null
    }
  });
}

return c.json(newInterest, 201);


  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error:`, error);
    return c.json({ 
      error: "Internal server error",
      requestId: "Include this in support tickets",
      timestamp: new Date().toISOString()
    }, 500);
  }
});

// Get interests for a request with pagination
app.get('/request/:requestId', async (c) => {
  try {
    const requestId = Number(c.req.param('requestId'));
    const page = Number(c.req.query('page')) || 1;
    const limit = Number(c.req.query('limit')) || 10;

    const result = await db.query.interests.findMany({
      where: eq(interests.requestId, requestId),
      with: {
        provider: {
          with: {
            user: {
              columns: {
                id: true,
                full_name: true,
                avatar: true
              }
            }
          }
        }
      },
      limit,
      offset: (page - 1) * limit,
      orderBy: (interests, { desc }) => [desc(interests.createdAt)]
    });

    const total = await db.select({ count: count() })
      .from(interests)
      .where(eq(interests.requestId, requestId));

    return c.json({
      data: result,
      meta: {
        total: total[0].count,
        page,
        limit,
        totalPages: Math.ceil(total[0].count / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching interests:', error);
    return c.json({ error: 'Failed to fetch interests' }, 500);
  }
});

// Get my interests with filters
app.get('/my', async (c) => {
  try {
    const user = c.get('user');
    const { status, page = 1, limit = 10 } = c.req.query();

    const provider = await db.query.providers.findFirst({
      where: eq(providers.userId, Number(user.id))
    });

    if (!provider) {
      return c.json({ error: 'Provider profile not found' }, 404);
    }

    const whereClause = status 
      ? and(
          eq(interests.providerId, provider.id),
          eq(interests.status, status)
        )
      : eq(interests.providerId, provider.id);

    const result = await db.query.interests.findMany({
      where: whereClause,
      with: {
        request: {
          with: {
            service: true,
            user: {
              columns: {
                id: true,
                full_name: true,
                avatar: true
              }
            }
          }
        }
      },
      limit: Number(limit),
      offset: (Number(page) - 1) * Number(limit),
      orderBy: (interests, { desc }) => [desc(interests.createdAt)]
    });

    const total = await db.select({ count: count() })
      .from(interests)
      .where(whereClause);

    return c.json({
      data: result,
      meta: {
        total: total[0].count,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total[0].count / Number(limit))
      }
    });
  } catch (error) {
    console.error('Error fetching interests:', error);
    return c.json({ error: 'Failed to fetch interests' }, 500);
  }
});

// Withdraw interest with enhanced checks
app.delete('/:interestId', async (c) => {
  try {
    const interestId = Number(c.req.param('interestId'));
    const user = c.get('user');

    // 1. Get the provider based on the logged-in user
    const provider = await db.query.providers.findFirst({
      where: eq(providers.userId, Number(user.id)),
      with: {
        user: true
      }
    });

    if (!provider) {
      return c.json({ error: 'Provider profile not found' }, 404);
    }

    // 2. Get the interest
    const interest = await db.query.interests.findFirst({
      where: and(
        eq(interests.id, interestId),
        eq(interests.providerId, provider.id)
      ),
      with: {
        request: {
          with: {
            user: true
          }
        }
      }
    });

    if (!interest) {
      return c.json({ 
        error: 'Interest not found or unauthorized',
        possibleReasons: [
          'Already withdrawn',
          'Does not belong to you',
          'Request closed'
        ]
      }, 404);
    }

    // 3. Ensure it's not accepted
    if (interest.status === 'accepted') {
      return c.json({ 
        error: 'Cannot withdraw accepted interest',
        solution: 'Contact the client directly'
      }, 400);
    }

    // 4. Delete the interest
    await db.delete(interests).where(eq(interests.id, interestId));

    // 5. Notify the client
    if (interest.request?.user?.id && interest.request?.id) {
      await notifyUser(
        interest.request.user.id,
        {
          userId: interest.request.user.id,
          type: 'interest_withdrawn',
          message: `${provider.user?.full_name || 'A provider'} has withdrawn interest in your request.`,
          relatedEntityId: interest.request.id
        }
      );
    }

    return c.json({ 
      message: 'Interest withdrawn successfully',
      withdrawnAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Delete Interest Error:', error);
    return c.json({
      error: 'Failed to withdraw interest',
      support: "contact@support.com"
    }, 500);
  }
});


// Add endpoints for client to accept/reject interests

app.post('/:interestId/accept', async (c) => {
  try {
    const interestId = Number(c.req.param('interestId'));
    const user = c.get('user');
    const userId = Number(user.id);

    // 1. Find interest with all needed relations
    const interest = await db.query.interests.findFirst({
  where: eq(interests.id, interestId),
  with: {
    provider: {
      columns: { userId: true },
      with: { 
        user: { columns: { id: true, full_name: true, avatar: true } } 
      }
    },
    request: { 
      columns: { id: true, userId: true, productName: true },
      with: { 
        user: { columns: { id: true, full_name: true, avatar: true } } 
      }
    }
  }
});


    if (!interest) {
      return c.json({ error: 'Interest not found' }, 404);
    }

    // 2. Validate ownership and required data
    if (!interest.request || !interest.provider || !interest.requestId) {
      return c.json({ error: 'Invalid interest data' }, 400);
    }

    if (interest.request.userId !== userId) {
      return c.json({ error: 'Unauthorized' }, 403);
    }

    // Type guard to ensure we have all required user data
    if (!interest.provider.user || !interest.request.user) {
      return c.json({ error: 'Missing user data' }, 400);
    }

    // 4. Check for existing chat
    const existingRoom = await db.query.chatRooms.findFirst({
      where: and(
        eq(chatRooms.requestId, interest.requestId),
        or(
          and(
            eq(chatRooms.clientId, interest.request.userId),
            eq(chatRooms.providerId, interest.provider.userId)
          ),
          and(
            eq(chatRooms.clientId, interest.provider.userId),
            eq(chatRooms.providerId, interest.request.userId)
          )
        )
      ),
      with: {
        request: true,
        client: true,
        provider: true
      }
    });

    let chatRoom;
    if (existingRoom) {
      chatRoom = existingRoom;
    } else {
      // 5. Create new chat room
      const [newRoom] = await db.insert(chatRooms).values({
        requestId: interest.requestId,
        clientId: interest.request.userId,
        providerId: interest.provider.userId,
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date()
      }).returning();

      if (!newRoom) {
        throw new Error('Failed to create chat room');
      }

      // 6. Create system welcome message
      await db.insert(messages).values({
        chatRoomId: newRoom.id,
        senderId: userId,
        content: `Chat started for request: ${interest.request.productName || 'Product'}`,
        isSystem: true,
        read: false,
        createdAt: new Date()
      });

      // Fetch the newly created room with relations
      const fetchedRoom = await db.query.chatRooms.findFirst({
        where: eq(chatRooms.id, newRoom.id),
        with: {
          request: true,
          client: true,
          provider: true
        }
      });

      if (!fetchedRoom) {
        throw new Error('Failed to fetch created chat room');
      }

      chatRoom = fetchedRoom;
    }

    // At this point, chatRoom is guaranteed to be defined
    if (!chatRoom) {
      throw new Error('Chat room not created or found');
    }

    // 7. Update interest
    await db.update(interests)
      .set({ status: 'accepted', chatRoomId: chatRoom.id })
      .where(eq(interests.id, interestId));

    // 8. Prepare response with all needed data
    const responseData = {
      id: chatRoom.id,
      requestId: chatRoom.requestId,
      clientId: chatRoom.clientId,
      providerId: chatRoom.providerId,
      status: chatRoom.status,
      createdAt: chatRoom.createdAt,
      updatedAt: chatRoom.updatedAt,
      request: {
        id: interest.request.id,
        productName: interest.request.productName
      },
      client: {
        id: interest.request.user.id,
        name: interest.request.user.full_name,
        avatar: interest.request.user.avatar
      },
      provider: {
        id: interest.provider.user.id,
        name: interest.provider.user.full_name,
        avatar: interest.provider.user.avatar
      }
    };

    // 9. Notify provider
    await notifyUser(interest.provider.userId, {
      type: 'interest_accepted',
      requestId: interest.requestId,
      chatRoomId: chatRoom.id
    });

    return c.json(responseData, existingRoom ? 200 : 201);

  } catch (error) {
    console.error('Error accepting interest:', error);
    return c.json({
      error: 'Failed to accept interest',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

app.post('/:interestId/reject', async (c) => {
  try {
    const interestId = Number(c.req.param('interestId'));
    const user = c.get('user');
 const userId = Number(user.id);

    console.log('Accept interest request:', { interestId, userId });
   const interest = await db.query.interests.findFirst({
  where: and(
    eq(interests.id, interestId),
    exists(
      db.select()
        .from(requests)
        .where(
          and(
            eq(requests.id, interests.requestId),
            eq(requests.userId, Number(user.id))
          )
        )
    )
  ),
  with: {
    provider: {
      with: {
        user: true
      }
    }
  }
});


    if (!interest) {
      return c.json({ error: 'Interest not found or unauthorized' }, 404);
    }

    await db.update(interests)
      .set({ status: 'rejected' })
      .where(eq(interests.id, interestId));

    // Notify provider
if (interest.provider?.user && interest.requestId !== null) {
  await notifyUser(interest.provider.user.id, {
    type: 'interest_rejected',
    requestId: interest.requestId,
    reason: 'Client declined your interest'
  });
}


    return c.json({ message: 'Interest rejected successfully' });

  } catch (error) {
    console.error('Error accepting interest:', error);
    return c.json({
      error: 'Failed to accept interest',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

export default app;