// websocket.ts
import { WebSocketServer } from 'ws';
import { verify } from 'hono/jwt';
import { db } from './drizzle/db.js';
import { notifications } from './drizzle/schema.js';
import { and, eq } from 'drizzle-orm';
import { JwtPayload } from './types/context.js'; 

interface WebSocketUser {
  userId: number;
  role: string;
}

const wss = new WebSocketServer({ port: 8080 });


wss.on('connection', (ws) => {
  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message.toString());
      
      if (data.type === 'auth') {
        const secret = process.env.JWT_SECRET;
        if (!secret) {
          console.error('JWT_SECRET is not set');
          return;
        }
        // Verify JWT token
        const payload = await verify(data.token, secret) as JwtPayload;
        
        if (payload && payload.id && payload.role) {
          (ws as any).user = {
            userId: parseInt(payload.id),
            role: payload.role
          };
          
          // Send any unread notifications
          const unreadNotifications = await db
            .select()
            .from(notifications)
            .where(
              and(
                eq(notifications.userId, parseInt(payload.id)),
                eq(notifications.isRead, false)
              )
            );
            
          ws.send(JSON.stringify({
            type: 'initial_notifications',
            data: unreadNotifications
          }));
        }
      }
    } catch (error) {
      console.error('WebSocket error:', error);
    }
  });
});

// Function to send real-time notification
export function sendRealTimeNotification(userId: number, notification: any) {
  wss.clients.forEach((client) => {
    const wsUser = (client as any).user as WebSocketUser | undefined;
    if (wsUser && wsUser.userId === userId) {
      client.send(JSON.stringify({
        type: 'notification',
        data: notification
      }));
    }
  });
}