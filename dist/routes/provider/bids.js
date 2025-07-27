import { Hono } from 'hono';
import { db } from '../../drizzle/db';
import { bids, requests, providers } from '../../drizzle/schema';
import { eq } from 'drizzle-orm';
import { authMiddleware, serviceProviderRoleAuth } from '../../middleware/bearAuth';
const app = new Hono();
app.use('*', authMiddleware, serviceProviderRoleAuth);
// Get provider's bids
app.get('/', async (c) => {
    const user = c.get('user'); // JwtPayload
    const userId = Number(user.id);
    const provider = await db.query.providers.findFirst({
        where: eq(providers.userId, userId),
    });
    if (!provider) {
        return c.json({ error: 'Provider profile not found' }, 404);
    }
    const providerBids = await db.query.bids.findMany({
        where: eq(bids.providerId, provider.id),
        with: {
            request: {
                with: {
                    user: true,
                    service: true,
                },
            },
        },
    });
    return c.json(providerBids);
});
// Place a new bid
app.post('/', async (c) => {
    const userId = Number(c.get('user').id); // Ensure it's a number
    const { requestId, price, message } = await c.req.json();
    const provider = await db.query.providers.findFirst({
        where: eq(providers.userId, userId),
    });
    if (!provider) {
        return c.json({ error: 'Provider profile not found' }, 404);
    }
    const request = await db.query.requests.findFirst({
        where: eq(requests.id, requestId),
    });
    if (!request) {
        return c.json({ error: 'Request not found' }, 404);
    }
    const isGraduateOfRequestedCollege = request.collegeFilterId
        ? request.collegeFilterId === provider.collegeId
        : false;
    const [bid] = await db.insert(bids).values({
        requestId,
        providerId: provider.id,
        price,
        message,
        isGraduateOfRequestedCollege,
    }).returning();
    return c.json(bid, 201);
});
export default app;
