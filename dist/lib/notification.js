// src/lib/notifications.ts
import { db } from '../drizzle/db';
import { notifications } from '../drizzle/schema';
const activeConnections = new Map();
export function registerConnection(userId, ws) {
    activeConnections.set(userId, ws);
    ws.on('close', () => activeConnections.delete(userId));
}
export async function sendNotification(userId, notification) {
    // Save to database
    const [savedNotification] = await db.insert(notifications)
        .values(notification)
        .returning();
    // Send real-time update if user is connected
    const ws = activeConnections.get(userId);
    if (ws) {
        ws.send(JSON.stringify({
            type: 'notification',
            data: savedNotification
        }));
    }
    return savedNotification;
}
