import { WebSocketServer, WebSocket } from 'ws';
import { db } from '../drizzle/db.js';
import { notifications } from '../drizzle/schema.js';
import { eq } from 'drizzle-orm';
import type { NotificationPayload } from '../types/types.js';

const activeConnections = new Map<number, WebSocket>();

// Create WebSocket server
const wss = new WebSocketServer({ port: 8080 });

wss.on('connection', (ws, req) => {
  try {
    const url = new URL(req.url || '', `ws://${req.headers.host}`);
    const userIdParam = url.searchParams.get('userId');

    if (userIdParam) {
      const userId = Number(userIdParam);
      activeConnections.set(userId, ws);

      // Mark existing notifications as read on connect
      db.update(notifications)
        .set({ isRead: true })
        .where(eq(notifications.userId, userId))
        .catch(console.error);

      ws.on('close', () => activeConnections.delete(userId));

      ws.on('message', (data) => {
        console.log(`🟡 WS message from ${userId}:`, data.toString());
        // Handle incoming message if needed
      });
    }
  } catch (err) {
    console.error('Error establishing WebSocket connection:', err);
  }
});

// Internal helper to persist the notification to DB
async function sendNotification(
  userId: number,
  notification: {
    userId: number;
    message: string;
    type: string;
    requestId?: number;
    relatedEntityId?: number;
    isRead?: boolean;
    createdAt: Date;
  }
) {
  const [savedNotification] = await db
    .insert(notifications)
    .values(notification)
    .returning();

  return savedNotification;
}

// ✅ Public function to notify a user via DB + WebSocket
// ✅ Fix inside notifyUser function
export async function notifyUser(userId: number, payload: NotificationPayload) {
  const {
    type,
    message = '',
    requestId,
    relatedEntityId,
    chatRoomId,
    client
  } = payload;

  // ✅ Safely convert complex object to string if needed
  const messageText = typeof message === 'string' ? message : message.content;

  // Save only DB-valid fields
  const saved = await sendNotification(userId, {
    userId,
    type,
    message: messageText, // ✅ Now guaranteed to be string
    requestId,
    relatedEntityId,
    isRead: false,
    createdAt: new Date()
  });

  // Send metadata-rich WebSocket payload
  broadcastToUser(userId, {
    type: 'notification',
    data: {
      ...saved,
      ...(chatRoomId ? { chatRoomId } : {}),
      ...(client ? { client } : {})
    }
  });

  return saved;
}


// ✅ Send any message to one connected user
export function broadcastToUser(userId: number, message: any) {
  const ws = activeConnections.get(userId);
  if (ws) {
    ws.send(JSON.stringify(message));
  }
}

// 🔄 Placeholder for future room-wide broadcast
export function broadcastToRoom(roomId: number, message: any) {
  // Implement room broadcasting later
}

export default notifyUser;
