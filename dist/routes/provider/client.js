// src/routes/client.ts
import { Hono } from 'hono';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../../drizzle/db';
import { requests, bids, notifications } from '../../drizzle/schema';
import { authMiddleware, clientRoleAuth } from '../../middleware/bearAuth';
const app = new Hono()
    .use('*', authMiddleware)
    .use('*', clientRoleAuth);
// Get client's requests with bids count
app.get('/requests', async (c) => {
    const user = c.get('user');
    const userId = Number(user.id); // ✅ convert to number
    if (isNaN(userId)) {
        return c.json({ error: 'Invalid user ID' }, 400);
    }
    const clientRequests = await db
        .select({
        request: requests,
        bidsCount: sql `COUNT(${bids.id})`,
    })
        .from(requests)
        .leftJoin(bids, eq(requests.id, bids.requestId))
        .where(eq(requests.userId, userId)) // ✅ now userId is a number
        .groupBy(requests.id)
        .orderBy(requests.createdAt);
    return c.json(clientRequests);
});
// Get detailed bids for a specific request
app.get('/requests/:id/bids', async (c) => {
    const userId = Number(c.get('user').id); // ✅ Convert string to number
    const requestId = parseInt(c.req.param('id'), 10); // ✅ Make sure it's a number
    if (isNaN(userId) || isNaN(requestId)) {
        return c.json({ error: 'Invalid user or request ID' }, 400);
    }
    // ✅ Verify request ownership
    const request = await db.query.requests.findFirst({
        where: and(eq(requests.id, requestId), eq(requests.userId, userId) // ✅ Now both sides are numbers
        )
    });
    if (!request) {
        return c.json({ error: 'Request not found or unauthorized' }, 404);
    }
    const requestBids = await db.query.bids.findMany({
        where: eq(bids.requestId, requestId),
        with: {
            provider: {
                with: {
                    user: true,
                },
            },
        },
        orderBy: (bids, { asc }) => [asc(bids.createdAt)],
    });
    return c.json(requestBids);
});
// Accept a bid with enhanced validation
app.post('/bids/:id/accept', async (c) => {
    const userId = Number(c.get('user').id); // ✅ Convert to number
    const bidId = parseInt(c.req.param('id'), 10);
    if (isNaN(userId) || isNaN(bidId)) {
        return c.json({ error: 'Invalid user or bid ID' }, 400);
    }
    const result = await db.transaction(async (tx) => {
        const bidWithRequest = await tx.query.bids.findFirst({
            where: eq(bids.id, bidId),
            with: {
                request: true,
            },
        });
        // ✅ Null check for bidWithRequest and bidWithRequest.request
        if (!bidWithRequest ||
            !bidWithRequest.request ||
            bidWithRequest.request.userId !== userId) {
            throw new Error('Bid not found or unauthorized');
        }
        if (bidWithRequest.request.status !== 'open') {
            throw new Error('Request is no longer open');
        }
        // ✅ Accept this bid
        await tx.update(bids)
            .set({ status: 'accepted' })
            .where(eq(bids.id, bidId));
        // ✅ Close the request
        await tx.update(requests)
            .set({ status: 'closed' })
            .where(eq(requests.id, bidWithRequest.request.id));
        // ✅ Reject all other pending bids for this request
        await tx.update(bids)
            .set({ status: 'rejected' })
            .where(and(eq(bids.requestId, bidWithRequest.request.id), eq(bids.status, 'pending')));
        // ✅ Send notifications
        await tx.insert(notifications).values([
            {
                userId: bidWithRequest.providerId,
                type: 'bid_accepted',
                message: `Your bid for request #${bidWithRequest.request.id} was accepted!`,
                relatedEntityId: bidId,
            },
            {
                userId: userId,
                type: 'bid_accepted_confirmation',
                message: `You accepted a bid from provider #${bidWithRequest.providerId} for request #${bidWithRequest.request.id}`,
                relatedEntityId: bidWithRequest.request.id,
            },
        ]);
        return { success: true };
    });
    return c.json(result);
});
// Notification endpoints
app.get('/notifications', async (c) => {
    const userId = Number(c.get('user').id);
    const userNotifications = await db.query.notifications.findMany({
        where: eq(notifications.userId, userId),
        orderBy: (n, { desc }) => [desc(n.createdAt)],
        limit: 50
    });
    return c.json(userNotifications);
});
app.patch('/notifications/:id/read', async (c) => {
    const userId = Number(c.get('user').id);
    const notificationId = parseInt(c.req.param('id'));
    await db.update(notifications)
        .set({ isRead: true })
        .where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId)));
    return c.json({ success: true });
});
app.post('/requests', async (c) => {
    const userId = Number(c.get('user').id);
    const body = await c.req.json();
    if (body.isService && !body.serviceId) {
        return c.json({ error: 'Service ID is required' }, 400);
    }
    if (!body.isService && !body.productName) {
        return c.json({ error: 'Product name is required' }, 400);
    }
    const [request] = await db.insert(requests).values({
        userId,
        serviceId: body.isService ? Number(body.serviceId) : null,
        productName: !body.isService ? body.productName : null,
        isService: Boolean(body.isService),
        description: body.description,
        desiredPrice: Number(body.desiredPrice),
        location: body.location,
        collegeFilterId: body.collegeFilterId ? Number(body.collegeFilterId) : null,
        status: 'open',
    }).returning();
    return c.json(request);
});
export default app;
