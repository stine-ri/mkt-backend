import { WebSocketServer, WebSocket } from 'ws';
import { verify } from 'hono/jwt';
import { db } from './drizzle/db.js';
import { notifications } from './drizzle/schema.js';
import { and, eq } from 'drizzle-orm';
import type { JwtPayload } from './types/context.js';

interface WebSocketUser {
  userId: number;
  role: string;
  roomId?: number;
}

const wss = new WebSocketServer({ port: 8081 });
const userClients = new Map<number, WebSocket>();
const chatRooms = new Map<number, Set<WebSocket>>(); // roomId -> clients

wss.on('connection', (ws, req) => {
  console.log('New WebSocket connection established');

  ws.on('message', async (rawMessage) => {
    try {
      const data = JSON.parse(rawMessage.toString());

      /**
       * 1️⃣ Handle authentication
       */
      if (data.type === 'auth') {
        const secret = process.env.JWT_SECRET;
        if (!secret) {
          console.error('JWT_SECRET is not set');
          ws.close(1011, 'Server configuration error');
          return;
        }

        try {
          const payload = await verify(data.token, secret) as JwtPayload;

          if (payload?.id && payload.role) {
            const userId = parseInt(payload.id);
            const userInfo: WebSocketUser = { userId, role: payload.role };
            (ws as any).user = userInfo;
            userClients.set(userId, ws);

            console.log(`User ${userId} authenticated and connected`);

            // Send unread notifications
            const unread = await db
              .select()
              .from(notifications)
              .where(and(
                eq(notifications.userId, userId),
                eq(notifications.isRead, false)
              ));

            ws.send(JSON.stringify({
              type: 'initial_notifications',
              data: unread
            }));

            // Send auth confirmation
            ws.send(JSON.stringify({
              type: 'auth_success',
              data: { userId, role: payload.role }
            }));
          } else {
            ws.close(1008, 'Invalid token payload');
          }
        } catch (authError) {
          console.error('JWT verification failed:', authError);
          ws.close(1008, 'Invalid token');
        }
      }

      /**
       * 2️⃣ Handle marking notifications as read
       */
      if (data.type === 'mark_as_read' && (ws as any).user) {
        const { notificationId } = data;
        const userId = (ws as any).user.userId;

        try {
          await db
            .update(notifications)
            .set({ isRead: true })
            .where(and(
              eq(notifications.id, notificationId),
              eq(notifications.userId, userId)
            ));

          console.log(`Marked notification ${notificationId} as read for user ${userId}`);
        } catch (error) {
          console.error('Error marking notification as read:', error);
        }
      }

      /**
       * 3️⃣ Handle marking all notifications as read
       */
      if (data.type === 'mark_all_read' && (ws as any).user) {
        const userId = (ws as any).user.userId;

        try {
          await db
            .update(notifications)
            .set({ isRead: true })
            .where(eq(notifications.userId, userId));

          console.log(`Marked all notifications as read for user ${userId}`);
        } catch (error) {
          console.error('Error marking all notifications as read:', error);
        }
      }

      /**
       * 4️⃣ Join a chat room
       */
      if (data.type === 'join_room' && (ws as any).user) {
        const roomId = parseInt(data.roomId);
        (ws as any).user.roomId = roomId;

        if (!chatRooms.has(roomId)) {
          chatRooms.set(roomId, new Set());
        }
        chatRooms.get(roomId)!.add(ws);
        console.log(`User ${(ws as any).user.userId} joined room ${roomId}`);
      }

      /**
       * 5️⃣ Handle sending chat messages
       */
      if (data.type === 'send_message' && (ws as any).user?.roomId) {
        const { roomId, userId } = (ws as any).user;
        const newMessage = {
          id: Date.now(),
          content: data.content,
          createdAt: new Date(),
          senderId: userId,
          read: false
        };

        // TODO: Save newMessage to your DB

        // Broadcast to everyone in the room
        chatRooms.get(roomId)?.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
              type: 'new_message',
              message: newMessage
            }));
          }
        });
      }

      /**
       * 6️⃣ Handle marking messages as read
       */
      if (data.type === 'mark_read' && (ws as any).user?.roomId) {
        const { roomId } = (ws as any).user;

        // TODO: Update DB to mark message as read

        // Notify everyone in the room
        chatRooms.get(roomId)?.forEach(client => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
              type: 'message_read',
              messageId: data.messageId
            }));
          }
        });
      }

    } catch (err) {
      console.error('WebSocket message parsing error:', err);
    }
  });

  ws.on('close', () => {
    const user = (ws as any).user as WebSocketUser | undefined;
    if (user?.userId) {
      userClients.delete(user.userId);
      console.log(`User ${user.userId} disconnected`);
    }
    if (user?.roomId) {
      chatRooms.get(user.roomId)?.delete(ws);
      if (chatRooms.get(user.roomId)?.size === 0) {
        chatRooms.delete(user.roomId);
      }
    }
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

/**
 * 🔔 Send notification to a specific user
 */
export async function sendRealTimeNotification(userId: number, notification: any) {
  const client = userClients.get(userId);
  if (client && client.readyState === WebSocket.OPEN) {
    client.send(JSON.stringify({
      type: 'notification',
      data: notification
    }));
    return true;
  }
  return false;
}

/**
 * 📢 Broadcast to a chat room
 */
export function broadcastToRoom(roomId: number, message: any) {
  const room = chatRooms.get(roomId);
  if (room) {
    room.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({
          type: 'room_message',
          data: message
        }));
      }
    });
  }
}

/**
 * 🔔 Main notification function - saves to DB and sends via WebSocket
 */
export async function notifyUser(userId: number, payload: any) {
  const {
    type,
    message = '',
    requestId,
    relatedEntityId,
    chatRoomId,
    client
  } = payload;

  // Convert complex message objects to strings
  const messageText = typeof message === 'string' ? message : message.content;

  try {
    // Save to database
    const [savedNotification] = await db
      .insert(notifications)
      .values({
        userId,
        type,
        message: messageText,
        requestId,
        relatedEntityId,
        isRead: false,
        createdAt: new Date()
      })
      .returning();

    // Send via WebSocket
    const notificationData = {
      ...savedNotification,
      ...(chatRoomId ? { chatRoomId } : {}),
      ...(client ? { client } : {})
    };

    const sent = await sendRealTimeNotification(userId, notificationData);
    
    if (sent) {
      console.log(`Notification sent to user ${userId}: ${type}`);
    } else {
      console.log(`User ${userId} not connected, notification saved to DB only`);
    }

    return savedNotification;
  } catch (error) {
    console.error('Error in notifyUser:', error);
    throw error;
  }
}

// Log server startup
console.log('🚀 WebSocket server running on port 8081');

export default notifyUser;