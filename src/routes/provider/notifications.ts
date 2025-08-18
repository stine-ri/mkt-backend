// src/routes/notifications.ts
import { Hono } from 'hono'
import { db } from '../../drizzle/db.js'
import { notifications } from '../../drizzle/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware } from '../../middleware/bearAuth.js'

// Define context type extensions
type Variables = {
  userId: number
}

const app = new Hono<{ Variables: Variables }>()

// Apply auth middleware
app.use('*', authMiddleware)

// Get all notifications for a user
app.get('/', async (c) => {
  const userId = c.get('userId')
  const { isRead } = c.req.query()

  try {
    // Build where conditions array
    const whereConditions = [eq(notifications.userId, userId)]
    
    // Add read filter if provided
    if (isRead !== undefined) {
      whereConditions.push(eq(notifications.isRead, isRead === 'true'))
    }

    // Execute query with combined where conditions
    const userNotifications = await db
      .select()
      .from(notifications)
      .where(and(...whereConditions))
      .orderBy(desc(notifications.createdAt)) // Use desc for newest first
    
    return c.json(userNotifications)
  } catch (error) {
    console.error('Error fetching notifications:', error)
    return c.json({ error: 'Failed to fetch notifications' }, 500)
  }
})

// Mark a notification as read
app.patch('/:id/read', async (c) => {
  const userId = c.get('userId')
  const notificationId = parseInt(c.req.param('id'))

  if (isNaN(notificationId)) {
    return c.json({ error: 'Invalid notification ID' }, 400)
  }

  try {
    // Verify the notification belongs to the user
    const [notification] = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.id, notificationId),
          eq(notifications.userId, userId)
        )
      )

    if (!notification) {
      return c.json({ error: 'Notification not found' }, 404)
    }

    // Update the notification
    const [updatedNotification] = await db
      .update(notifications)
      .set({ isRead: true })
      .where(eq(notifications.id, notificationId))
      .returning()

    return c.json({ success: true, notification: updatedNotification })
  } catch (error) {
    console.error('Error marking notification as read:', error)
    return c.json({ error: 'Failed to mark notification as read' }, 500)
  }
})

// Mark all notifications as read
app.patch('/read-all', async (c) => {
  const userId = c.get('userId')

  try {
    const updatedNotifications = await db
      .update(notifications)
      .set({ isRead: true })
      .where(eq(notifications.userId, userId))
      .returning({ id: notifications.id })

    return c.json({ 
      success: true, 
      updatedCount: updatedNotifications.length 
    })
  } catch (error) {
    console.error('Error marking all notifications as read:', error)
    return c.json({ error: 'Failed to mark all notifications as read' }, 500)
  }
})

export default app