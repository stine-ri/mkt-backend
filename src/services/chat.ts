// services/chat.ts
import { Hono } from 'hono';
import { db } from './../drizzle/db.js';
import { chatRooms, messages, paymentAgreements, requests, users, providers } from './../drizzle/schema.js';
import { eq, and, desc, or, exists, InferModel } from 'drizzle-orm';
import type { CustomContext } from '../types/context.js';
import { notifyUser } from '../lib/notification.js';

const app = new Hono<CustomContext>();

type ProviderInfo = {
  id: number;
  name: string;
  avatar: string | null;
};

type RoomWithProvider = {
  provider: ProviderInfo;
};

type User = typeof users.$inferSelect; // ✅ recommended

// Get chat rooms for user

// In services/chat.ts
app.get('/', async (c) => {
  try {
    const user = c.get('user');
    const userId = Number(user.id);
    console.log(`Current user ID: ${userId}`); 

    // Use this query structure instead
    const rooms = await db.query.chatRooms.findMany({
      where: or(
        eq(chatRooms.clientId, userId),
        eq(chatRooms.providerId, userId)
      ),
      with: {
        request: {
          columns: {
            id: true,
            productName: true
          }
        },
        client: {
          columns: {
            id: true,
            full_name: true,
            avatar: true
          }
        },
        provider: {
          columns: {
            id: true,
            full_name: true,
            avatar: true
          }
        },
        messages: {
          orderBy: [desc(messages.createdAt)],
          limit: 1
        }
      },
      orderBy: [desc(chatRooms.updatedAt)]
    });
   console.log(`Found ${rooms.length} rooms`);
    return c.json(rooms);
  } catch (error) {
    console.error('Detailed error:', error);
    return c.json({ 
      error: 'Failed to fetch chat rooms',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

// Get messages in a chat room
app.get('/:roomId/messages', async (c) => {
  try {
    const roomId = Number(c.req.param('roomId'));
        // Add validation
    if (isNaN(roomId)) {
      return c.json({ error: 'Invalid chat room ID' }, 400);
    }
    const user = c.get('user');
    const userId = Number(user.id);

    // Verify user has access to this chat room
    const room = await db.query.chatRooms.findFirst({
      where: and(
        eq(chatRooms.id, roomId),
        or(
          eq(chatRooms.clientId, userId),
          eq(chatRooms.providerId, userId)
        )
      )
    });

    if (!room) {
      return c.json({ error: 'Unauthorized access to chat room' }, 403);
    }

    // ✅ Rename this variable to avoid shadowing
    const chatMessages = await db.query.messages.findMany({
      where: eq(messages.chatRoomId, roomId),
      with: {
        sender: {
          columns: {
            id: true,
            full_name: true, 
            avatar: true
          }
        }
      },
      orderBy: [desc(messages.createdAt)],
      limit: 100
    });

    // Mark messages as read
    await db.update(messages)
      .set({ read: true })
      .where(and(
        eq(messages.chatRoomId, roomId),
        eq(messages.senderId, userId),
        eq(messages.read, false)
      ));

    return c.json(chatMessages.reverse()); // Return oldest first
  }catch (error) {
  console.error('Error fetching messages:', error);

  if (error instanceof Error) {
    return c.json(
      {
        error: 'Failed to fetch messages',
        details: error.message,
      },
      500
    );
  }

  // fallback if error is not an instance of Error
  return c.json(
    {
      error: 'Failed to fetch messages',
      details: 'An unknown error occurred',
    },
    500
  );
}
});


// Send a message

app.post('/:roomId/messages', async (c) => {
  try {
    const roomId = Number(c.req.param('roomId'));
    const user = c.get('user');
    const userId = Number(user.id);
    const { content } = await c.req.json();

    // Validate input
    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      return c.json({ error: 'Message content is required' }, 400);
    }

    // Verify user has access (simplified query)
const roomExists = await db.query.chatRooms.findFirst({
  where: and(
    eq(chatRooms.id, roomId),
    or(
      eq(chatRooms.clientId, userId),
      eq(chatRooms.providerId, userId)
    )
  ),
  columns: {
    id: true,
    clientId: true,
    providerId: true
  }
});


    if (!roomExists) {
      return c.json({ error: 'Unauthorized access to chat room' }, 403);
    }

    // Insert message without trying to return relations
    const [message] = await db.insert(messages).values({
      chatRoomId: roomId,
      senderId: userId,
      content,
      createdAt: new Date(),
      read: false
    }).returning({
      id: messages.id,
      content: messages.content,
      createdAt: messages.createdAt,
      read: messages.read,
      chatRoomId: messages.chatRoomId,
      senderId: messages.senderId
    });

    // Update chat room timestamp
    await db.update(chatRooms)
      .set({ updatedAt: new Date() })
      .where(eq(chatRooms.id, roomId));

    // Manually construct response with sender info
    return c.json({
      id: message.id,
      content: message.content,
      createdAt: message.createdAt,
      read: message.read,
      sender: {
        id: userId,
        name: user.name || 'Unknown',
        avatar: user.avatar
      }
    }, 201);

  } catch (error) {
    console.error('Detailed error sending message:', error);
    return c.json({ 
      error: 'Failed to send message',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

// Payment agreement endpoints
app.post('/:roomId/agreements', async (c) => {
  try {
    const roomId = Number(c.req.param('roomId'));
    const user = c.get('user');
    const userId = Number(user.id);
    const { amount, paymentMethod, terms } = await c.req.json();

    // Verify user has access and is the client
    const room = await db.query.chatRooms.findFirst({
      where: and(
        eq(chatRooms.id, roomId),
        eq(chatRooms.clientId, userId)
      )
    });

    if (!room) {
      return c.json({ error: 'Unauthorized access to chat room' }, 403);
    }

    // Create payment agreement
    const [agreement] = await db.insert(paymentAgreements).values({
      chatRoomId: roomId,
      amount: amount.toString(),
      paymentMethod,
      terms,
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date()
    }).returning();

    // Create system message
    await db.insert(messages).values({
      chatRoomId: roomId,
      senderId: userId,
      content: `Payment agreement created: KSh ${amount} via ${paymentMethod}`,
      isSystem: true,
      read: false,
      createdAt: new Date()
    });

    // Get provider info through proper relations
    const provider = await db.query.providers.findFirst({
      where: eq(providers.id, room.providerId),
      columns: {
        userId: true
      }
    });

    if (!provider) {
      return c.json({ error: 'Provider not found' }, 404);
    }

    // Notify provider using the user ID
    await notifyUser(provider.userId, {
      type: 'new_payment_agreement',
      chatRoomId: roomId,
      agreement: {
        id: agreement.id,
        amount,
        paymentMethod
      }
    });

    return c.json(agreement, 201);
  } catch (error) {
    console.error('Error creating payment agreement:', error);
    return c.json({ error: 'Failed to create payment agreement' }, 500);
  }
});

// Get payment agreement for a chat room
app.get('/:roomId/agreements', async (c) => {
  try {
    const roomId = Number(c.req.param('roomId'));
    const user = c.get('user');
    const userId = Number(user.id);

    // Verify user has access to this chat room
    const room = await db.query.chatRooms.findFirst({
      where: and(
        eq(chatRooms.id, roomId),
        or(
          eq(chatRooms.clientId, userId),
          eq(chatRooms.providerId, userId)
        )
      )
    });

    if (!room) {
      return c.json({ error: 'Unauthorized access to chat room' }, 403);
    }

    const agreement = await db.query.paymentAgreements.findFirst({
      where: eq(paymentAgreements.chatRoomId, roomId),
      orderBy: [desc(paymentAgreements.createdAt)]
    });

    return c.json(agreement || null);
  } catch (error) {
    console.error('Error fetching payment agreement:', error);
    return c.json({ error: 'Failed to fetch payment agreement' }, 500);
  }
});

// Accept payment agreement
app.post('/:roomId/agreements/:agreementId/accept', async (c) => {
  try {
    const roomId = Number(c.req.param('roomId'));
    const agreementId = Number(c.req.param('agreementId'));
    const user = c.get('user');
    const userId = Number(user.id);

    // Verify user is the provider in this chat room
    const room = await db.query.chatRooms.findFirst({
      where: and(
        eq(chatRooms.id, roomId),
        eq(chatRooms.providerId, userId)
      )
    });

    if (!room) {
      return c.json({ error: 'Unauthorized access to chat room' }, 403);
    }

    // Update agreement status
    const [agreement] = await db.update(paymentAgreements)
      .set({ 
        status: 'accepted',
        updatedAt: new Date()
      })
      .where(and(
        eq(paymentAgreements.id, agreementId),
        eq(paymentAgreements.chatRoomId, roomId)
      ))
      .returning();

    // Create system message
    await db.insert(messages).values({
      chatRoomId: roomId,
      senderId: userId,
      content: `Payment agreement accepted`,
      isSystem: true,
      createdAt: new Date()
    });

    // Notify client
    const roomWithClient = await db.query.chatRooms.findFirst({
      where: eq(chatRooms.id, roomId),
      with: {
        client: true as true
      }
    }) as { client: User } | null;

 if (roomWithClient?.client) {
  await notifyUser(roomWithClient.client.id, {
    type: 'payment_agreement_accepted',
    chatRoomId: roomId,
    agreement: {
      id: agreement.id,
      amount:Number (agreement.amount),
      paymentMethod: agreement.paymentMethod
    }
  });
}


    return c.json(agreement);
  } catch (error) {
    console.error('Error accepting payment agreement:', error);
    return c.json({ error: 'Failed to accept payment agreement' }, 500);
  }
});

export default app;