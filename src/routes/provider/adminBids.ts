// src/routes/admin/bids.ts
import { Hono } from 'hono';
import { db } from '../../drizzle/db.js';
import { bids, providers, requests, users, services, colleges } from '../../drizzle/schema.js';
import { and, eq, desc, ilike, or, count, inArray } from 'drizzle-orm';
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
 * GET /api/admin/bids/requests
 * Get all requests with their bids (grouped by request)
 * IMPORTANT: This route must come BEFORE /:id route
 */
app.get('/requests', async (c) => {
  try {
    const { page = '1', limit = '10', status, search } = c.req.query();

    const pageNum = Math.max(1, parseInt(page as string) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string) || 10));
    const offset = (pageNum - 1) * limitNum;

    // Build conditions array
    const conditions = [];

    if (status && ['open', 'closed', 'pending', 'in_progress', 'completed', 'cancelled'].includes(status)) {
      conditions.push(eq(requests.status, status as any));
    }

    if (search) {
      const searchTerm = `%${search}%`;
      conditions.push(
        or(
          ilike(requests.productName, searchTerm),
          ilike(requests.description, searchTerm),
          ilike(users.full_name, searchTerm),
          ilike(services.name, searchTerm),
          ilike(colleges.name, searchTerm)
        )
      );
    }

    // Get requests with user, service, and college info
    const requestsQuery = db
      .select({
        id: requests.id,
        userId: requests.userId,
        serviceId: requests.serviceId,
        productName: requests.productName,
        isService: requests.isService,
        description: requests.description,
        desiredPrice: requests.desiredPrice,
        location: requests.location,
        collegeFilterId: requests.collegeFilterId,
        status: requests.status,
        allowInterests: requests.allowInterests,
        allowBids: requests.allowBids,
        accepted_bid_id: requests.accepted_bid_id,
        createdAt: requests.createdAt,
        user: {
          id: users.id,
          email: users.email,
          full_name: users.full_name,
          role: users.role
        },
        service: {
          id: services.id,
          name: services.name,
          category: services.category
        },
        college: {
          id: colleges.id,
          name: colleges.name,
          location: colleges.location
        }
      })
      .from(requests)
      .leftJoin(users, eq(requests.userId, users.id))
      .leftJoin(services, eq(requests.serviceId, services.id))
      .leftJoin(colleges, eq(requests.collegeFilterId, colleges.id));

    // Apply combined conditions
    if (conditions.length > 0) {
      requestsQuery.where(conditions.length === 1 ? conditions[0] : and(...conditions));
    }

    const requestsData = await requestsQuery
      .orderBy(desc(requests.createdAt))
      .limit(limitNum)
      .offset(offset);

    // Get bids for these requests
    const requestIds = requestsData.map(r => r.id);
    let bidsData: any[] = [];

    if (requestIds.length > 0) {
      bidsData = await db
        .select({
          id: bids.id,
          requestId: bids.requestId,
          providerId: bids.providerId,
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
          }
        })
        .from(bids)
        .leftJoin(providers, eq(bids.providerId, providers.id))
        .leftJoin(users, eq(providers.userId, users.id))
        .where(inArray(bids.requestId, requestIds))
        .orderBy(desc(bids.createdAt));
    }

    // Combine requests with their bids
    const data = requestsData.map(request => ({
      ...request,
      bids: bidsData.filter(bid => bid.requestId === request.id),
      bidsCount: bidsData.filter(bid => bid.requestId === request.id).length
    }));

    // Count total requests
    const countQueryBuilder = db
      .select({ count: count() })
      .from(requests)
      .leftJoin(users, eq(requests.userId, users.id))
      .leftJoin(services, eq(requests.serviceId, services.id))
      .leftJoin(colleges, eq(requests.collegeFilterId, colleges.id));

    if (conditions.length > 0) {
      countQueryBuilder.where(conditions.length === 1 ? conditions[0] : and(...conditions));
    }

    const totalResult = await countQueryBuilder;
    const total = totalResult[0]?.count || 0;

    return c.json({
      success: true,
      data,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    });

  } catch (error) {
    console.error('Error fetching requests with bids:', error);
    return c.json({
      success: false,
      error: 'Failed to fetch requests with bids',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

/**
 * GET /api/admin/bids/:id
 * Get bid details by ID
 * IMPORTANT: This route must come AFTER /requests route
 */
app.get('/:id', async (c) => {
  const idParam = c.req.param('id');
  
  // Validate the ID parameter
  if (!idParam) {
    return c.json({ 
      success: false, 
      error: 'Bid ID is required' 
    }, 400);
  }

  const bidId = parseInt(idParam, 10);
  
  // Check if the conversion resulted in a valid integer
  if (isNaN(bidId) || bidId <= 0) {
    return c.json({ 
      success: false, 
      error: 'Invalid bid ID. Must be a positive integer.' 
    }, 400);
  }

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
      return c.json({ 
        success: false, 
        error: 'Bid not found' 
      }, 404);
    }

    return c.json({ success: true, data: bid });

  } catch (error) {
    console.error('Error fetching bid:', error);
    return c.json({ 
      success: false, 
      error: 'Failed to fetch bid',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

export default app;