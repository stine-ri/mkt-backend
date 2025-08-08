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
          return;
        }

        const payload = await verify(data.token, secret) as JwtPayload;

        if (payload?.id && payload.role) {
          const userId = parseInt(payload.id);
          const userInfo: WebSocketUser = { userId, role: payload.role };
          (ws as any).user = userInfo;
          userClients.set(userId, ws);

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

          // Mark notifications as read
          await db.update(notifications)
            .set({ isRead: true })
            .where(eq(notifications.userId, userId));
        }
      }

      /**
       * 2️⃣ Join a chat room
       */
      if (data.type === 'join_room' && (ws as any).user) {
        const roomId = parseInt(data.roomId);
        (ws as any).user.roomId = roomId;

        if (!chatRooms.has(roomId)) {
          chatRooms.set(roomId, new Set());
        }
        chatRooms.get(roomId)!.add(ws);
      }

      /**
       * 3️⃣ Handle sending chat messages
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
       * 4️⃣ Handle marking messages as read
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
      console.error('WebSocket error:', err);
    }
  });

  ws.on('close', () => {
    const user = (ws as any).user as WebSocketUser | undefined;
    if (user?.userId) {
      userClients.delete(user.userId);
    }
    if (user?.roomId) {
      chatRooms.get(user.roomId)?.delete(ws);
      if (chatRooms.get(user.roomId)?.size === 0) {
        chatRooms.delete(user.roomId);
      }
    }
  });
});

/**
 * 🔔 Send notification to a specific user
 */
export function sendRealTimeNotification(userId: number, notification: any) {
  const client = userClients.get(userId);
  if (client) {
    client.send(JSON.stringify({
      type: 'notification',
      data: notification
    }));
  }
}

/**
 * 📢 Broadcast to a chat room
 */
export function broadcastToRoom(roomId: number, message: any) {
  chatRooms.get(roomId)?.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({
        type: 'room_message',
        data: message
      }));
    }
  });
}
