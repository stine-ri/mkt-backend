// services/chat.ts
import { Hono } from 'hono';
import { db } from './../drizzle/db.js';
import { chatRooms, messages, paymentAgreements, users } from './../drizzle/schema.js';
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
app.get('/', async (c) => {
  try {
    const user = c.get('user');
    const userId = Number(user.id);

    const rooms = await db.query.chatRooms.findMany({
      where: or(
        eq(chatRooms.clientId, userId),
        eq(chatRooms.providerId, userId)
      ),
      with: {
        request: {
          columns: {
            id: true,
            title: true
          }
        },
        client: {
          columns: {
            id: true,
            name: true,
            avatar: true
          }
        },
        provider: {
          columns: {
            id: true,
            name: true,
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

    return c.json(rooms);
  } catch (error) {
    console.error('Error fetching chat rooms:', error);
    return c.json({ error: 'Failed to fetch chat rooms' }, 500);
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
            name: true,
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

    // Verify user has access to this chat room
    const room = await db.query.chatRooms.findFirst({
      where: and(
        eq(chatRooms.id, roomId),
        or(
          eq(chatRooms.clientId, userId),
          eq(chatRooms.providerId, userId)
        )
      ),
      with: {
        client: true,
        provider: true
      }
    });

    if (!room) {
      return c.json({ error: 'Unauthorized access to chat room' }, 403);
    }

    const [message] = await db.insert(messages).values({
      chatRoomId: roomId,
      senderId: userId,
      content,
      createdAt: new Date()
    }).returning();

    // Update chat room's updatedAt
    await db.update(chatRooms)
      .set({ updatedAt: new Date() })
      .where(eq(chatRooms.id, roomId));

    // Notify the other participant
    const recipientId = userId === room.clientId ? room.providerId : room.clientId;
    await notifyUser(recipientId, {
      type: 'new_message',
      chatRoomId: roomId,
      sender: {
        id: userId,
        name: user.name ?? 'Unknown',
        avatar: user.avatar
      },
      message: {
        id: message.id,
        content: message.content,
        createdAt: message.createdAt
      }
    });

    return c.json(message, 201);
  } catch (error) {
    console.error('Error sending message:', error);
    return c.json({ error: 'Failed to send message' }, 500);
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

    const [agreement] = await db.insert(paymentAgreements).values({
      chatRoomId: roomId,
      amount,
      paymentMethod,
      terms,
      createdAt: new Date(),
      updatedAt: new Date()
    }).returning();

    // Create a system message
    await db.insert(messages).values({
      chatRoomId: roomId,
      senderId: userId,
      content: `Payment agreement created: KSh ${amount} via ${paymentMethod}`,
      isSystem: true,
      createdAt: new Date()
    });

    // Notify provider
    const roomWithProvider = await db.query.chatRooms.findFirst({
      where: eq(chatRooms.id, roomId),
      with: {
        provider: true
      }
    }) as RoomWithProvider;

    if (roomWithProvider?.provider) {
      await notifyUser(roomWithProvider.provider.id, {
        type: 'new_payment_agreement',
        chatRoomId: roomId,
        agreement: {
          id: agreement.id,
          amount,
          paymentMethod
        }
      
      });
    }

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