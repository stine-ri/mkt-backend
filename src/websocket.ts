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

wss.on('connection', (ws, req) => {
  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message.toString());

      // 🔐 Handle initial auth with JWT
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

          // 🟢 Send unread notifications
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

          // ✅ Mark as read in DB
          await db.update(notifications)
            .set({ isRead: true })
            .where(eq(notifications.userId, userId));
        }
      }

      // 🟣 Handle joining a room
      if (data.type === 'join_room' && (ws as any).user) {
        (ws as any).user.roomId = data.roomId;
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
  });
});


// 🔔 Send notification to specific user
export function sendRealTimeNotification(userId: number, notification: any) {
  const client = userClients.get(userId);
  if (client) {
    client.send(JSON.stringify({
      type: 'notification',
      data: notification
    }));
  }
}

// 📢 Broadcast to a room (e.g., chat messages)
export function broadcastToRoom(roomId: number, message: any) {
  wss.clients.forEach((client) => {
    const user = (client as any).user as WebSocketUser | undefined;
    if (user?.roomId === roomId) {
      client.send(JSON.stringify({
        type: 'room_message',
        data: message
      }));
    }
  });
}
