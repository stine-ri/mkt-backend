// src/routes/admin/bids.ts
import { Hono } from 'hono';
import { db } from '../../drizzle/db.js';
import { bids, providers, requests, users } from '../../drizzle/schema.js';
import { and, eq, desc } from 'drizzle-orm';
import { adminRoleAuth } from '../../middleware/bearAuth.js';
import type { CustomContext } from '../../types/context.js';

const app = new Hono<CustomContext>();

// Apply admin auth middleware to all routes
app.use('*', adminRoleAuth);

/**
 * GET /api/admin/bids
 * Get all bids with filtering and pagination
 */
app.get('/', async (c) => {
  const { status, page = 1, limit = 20 } = c.req.query();

  try {
    // Base query with joins
    const query = db.select({
      id: bids.id,
      price: bids.price,
      message: bids.message,
      status: bids.status,
      createdAt: bids.createdAt,
      isGraduateOfRequestedCollege: bids.isGraduateOfRequestedCollege,
      provider: {
        id: providers.id,
        firstName: providers.firstName,
        lastName: providers.lastName,
        email: users.email
      },
request: {
  id: requests.id,
  productName: requests.productName,
  description: requests.description,
  status: requests.status,
  serviceId: requests.serviceId // foreign key reference
}

    })
    .from(bids)
    .leftJoin(providers, eq(bids.providerId, providers.id))
    .leftJoin(users, eq(providers.userId, users.id))
    .leftJoin(requests, eq(bids.requestId, requests.id))
    .orderBy(desc(bids.createdAt));

    // Apply status filter if provided
   if (status && ['pending', 'accepted', 'rejected'].includes(status)) {
  query.where(eq(bids.status, status as 'pending' | 'accepted' | 'rejected'));
}


    // Apply pagination
   const pageNum = typeof page === 'string' ? parseInt(page) : page;
const limitNum = typeof limit === 'string' ? parseInt(limit) : limit;

const offset = (pageNum - 1) * limitNum;
query.limit(limitNum).offset(offset);

    const result = await query;

    return c.json({
      success: true,
      data: result,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: await db.select().from(bids).then(r => r.length)
      }
    });

  } catch (error) {
    console.error('Error fetching bids:', error);
    return c.json({ 
      success: false,
      error: 'Failed to fetch bids',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

/**
 * GET /api/admin/bids/:id
 * Get bid details by ID
 */
app.get('/:id', async (c) => {
  const bidId = Number(c.req.param('id'));

  try {
    const bid = await db.query.bids.findFirst({
      where: eq(bids.id, bidId),
      with: {
        provider: {
          with: {
            user: true,
            college: true
          }
        },
        request: {
          with: {
            user: true,
            service: true
          }
        }
      }
    });

    if (!bid) {
      return c.json({ error: 'Bid not found' }, 404);
    }

    return c.json({ success: true, data: bid });

  } catch (error) {
    console.error('Error fetching bid:', error);
    return c.json({ error: 'Failed to fetch bid' }, 500);
  }
});

export default app;