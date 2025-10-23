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
    // Step 1: Get bids with provider info
    const bidsQuery = db
      .select({
        bid: {
          id: bids.id,
          price: bids.price,
          message: bids.message,
          status: bids.status,
          createdAt: bids.createdAt,
          isGraduateOfRequestedCollege: bids.isGraduateOfRequestedCollege,
          requestId: bids.requestId,
          providerId: bids.providerId
        },
        provider: {
          id: providers.id,
          firstName: providers.firstName,
          lastName: providers.lastName
        },
        providerUser: {
          email: users.email
        },
        request: {
          id: requests.id,
          productName: requests.productName,
          description: requests.description,
          status: requests.status,
          serviceId: requests.serviceId,
          userId: requests.userId
        },
        service: {
          id: services.id,
          name: services.name,
          category: services.category
        }
      })
      .from(bids)
      .leftJoin(providers, eq(bids.providerId, providers.id))
      .leftJoin(users, eq(providers.userId, users.id)) // Provider's user
      .leftJoin(requests, eq(bids.requestId, requests.id))
      .leftJoin(services, eq(requests.serviceId, services.id))
      .orderBy(desc(bids.createdAt));

    // Apply status filter if provided
    if (status && ['pending', 'accepted', 'rejected'].includes(status)) {
      bidsQuery.where(eq(bids.status, status as 'pending' | 'accepted' | 'rejected'));
    }

    // Apply pagination
    const pageNum = typeof page === 'string' ? parseInt(page) : page;
    const limitNum = typeof limit === 'string' ? parseInt(limit) : limit;
    const offset = (pageNum - 1) * limitNum;

    bidsQuery.limit(limitNum).offset(offset);
    const bidsResult = await bidsQuery;

    // Step 2: Get request user details separately
    const requestUserIds = [...new Set(bidsResult.map(b => b.request?.userId).filter(Boolean))];
    let requestUsers: any[] = [];

    if (requestUserIds.length > 0) {
      requestUsers = await db
        .select({
          id: users.id,
          full_name: users.full_name,
          email: users.email
        })
        .from(users)
        .where(inArray(users.id, requestUserIds as number[]));
    }

    // Step 3: Transform the data to match frontend expectations
    const result = bidsResult.map(item => {
      const requestUser = requestUsers.find(u => u.id === item.request?.userId);
      
      return {
        id: item.bid.id,
        price: item.bid.price,
        message: item.bid.message,
        status: item.bid.status,
        createdAt: item.bid.createdAt,
        isGraduateOfRequestedCollege: item.bid.isGraduateOfRequestedCollege,
        provider: item.provider ? {
          id: item.provider.id,
          firstName: item.provider.firstName,
          lastName: item.provider.lastName,
          email: item.providerUser?.email || null
        } : null,
        request: item.request ? {
          id: item.request.id,
          title: item.request.productName, // Map to title for frontend
          productName: item.request.productName,
          description: item.request.description,
          status: item.request.status,
          serviceId: item.request.serviceId,
          user: requestUser ? {
            id: requestUser.id,
            full_name: requestUser.full_name,
            email: requestUser.email
          } : null,
          service: item.service
        } : null
      };
    });

    // Get total count
    const totalQuery = db.select({ count: count() }).from(bids);
    if (status && ['pending', 'accepted', 'rejected'].includes(status)) {
      totalQuery.where(eq(bids.status, status as 'pending' | 'accepted' | 'rejected'));
    }
    const totalResult = await totalQuery;
    const total = totalResult[0]?.count || 0;

    return c.json({
      success: true,
      data: result,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total
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
 */
app.get('/requests', async (c) => {
  try {
    const { page = '1', limit = '10', status, search } = c.req.query();

    const pageNum = Math.max(1, parseInt(page as string) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string) || 10));
    const offset = (pageNum - 1) * limitNum;

    // Build conditions array
    const conditions = [];

   if (status && ['open', 'closed', 'pending'].includes(status)) {
  conditions.push(eq(requests.status, status as "open" | "closed" | "pending"));
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
            lastName: providers.lastName
          },
          providerUser: {
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
      bids: bidsData
        .filter(bid => bid.requestId === request.id)
        .map(bid => ({
          id: bid.id,
          requestId: bid.requestId,
          providerId: bid.providerId,
          price: bid.price,
          message: bid.message,
          status: bid.status,
          createdAt: bid.createdAt,
          isGraduateOfRequestedCollege: bid.isGraduateOfRequestedCollege,
          provider: bid.provider ? {
            id: bid.provider.id,
            firstName: bid.provider.firstName,
            lastName: bid.provider.lastName,
            email: bid.providerUser?.email || null
          } : null
        })),
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
 */
app.get('/:id', async (c) => {
  const idParam = c.req.param('id');
  
  if (!idParam) {
    return c.json({ 
      success: false, 
      error: 'Bid ID is required' 
    }, 400);
  }

  const bidId = parseInt(idParam, 10);
  
  if (isNaN(bidId) || bidId <= 0) {
    return c.json({ 
      success: false, 
      error: 'Invalid bid ID. Must be a positive integer.' 
    }, 400);
  }

  try {
    // Get bid with all related data using separate queries
    const bidResult = await db
      .select({
        bid: bids,
        provider: {
          id: providers.id,
          firstName: providers.firstName,
          lastName: providers.lastName,
          collegeId: providers.collegeId
        },
        providerUser: {
          email: users.email
        },
        request: requests,
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
      .from(bids)
      .leftJoin(providers, eq(bids.providerId, providers.id))
      .leftJoin(users, eq(providers.userId, users.id))
      .leftJoin(requests, eq(bids.requestId, requests.id))
      .leftJoin(services, eq(requests.serviceId, services.id))
      .leftJoin(colleges, eq(providers.collegeId, colleges.id))
      .where(eq(bids.id, bidId))
      .then(results => results[0]);

    if (!bidResult) {
      return c.json({ 
        success: false, 
        error: 'Bid not found' 
      }, 404);
    }

    // Get request user separately
    let requestUser = null;
    if (bidResult.request?.userId) {
      requestUser = await db
        .select({
          id: users.id,
          full_name: users.full_name,
          email: users.email
        })
        .from(users)
        .where(eq(users.id, bidResult.request.userId))
        .then(results => results[0]);
    }

    // Transform the data
    const bid = {
      ...bidResult.bid,
      provider: bidResult.provider ? {
        ...bidResult.provider,
        email: bidResult.providerUser?.email || null,
        college: bidResult.college
      } : null,
      request: bidResult.request ? {
        ...bidResult.request,
        title: bidResult.request.productName, // Map to title
        user: requestUser,
        service: bidResult.service
      } : null
    };

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