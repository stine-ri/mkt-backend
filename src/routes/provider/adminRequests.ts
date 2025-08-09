import { Hono } from 'hono';
import { db } from '../../drizzle/db.js';
import { requests, users, services, colleges, bids } from '../../drizzle/schema.js';
import { eq, desc, ilike, or, count } from 'drizzle-orm';
import { adminRoleAuth } from '../../middleware/bearAuth.js';
import type { CustomContext } from '../../types/context.js';

const app = new Hono<CustomContext>();

// Apply admin auth middleware to all routes
app.use('*', adminRoleAuth);

//admin fetch all requests
app.get('/requests', async (c) => {
  try {
    const { page = '1', limit = '20', status, search } = c.req.query();

    // Convert and validate pagination params
    const pageNum = Math.max(1, parseInt(page as string) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string) || 20));
    const offset = (pageNum - 1) * limitNum;

    // Build the main query with all joins and filters
    const queryBuilder = db
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
        },
        bidsCount: count(bids.id).as('bidsCount')
      })
      .from(requests)
      .leftJoin(users, eq(requests.userId, users.id))
      .leftJoin(services, eq(requests.serviceId, services.id))
      .leftJoin(colleges, eq(requests.collegeFilterId, colleges.id))
      .leftJoin(bids, eq(requests.id, bids.requestId));

    // Apply filters conditionally
    if (status && ['open', 'closed', 'pending'].includes(status)) {
      queryBuilder.where(eq(requests.status, status as 'open' | 'closed' | 'pending'));
    }

    if (search) {
      const searchTerm = `%${search}%`;
      queryBuilder.where(
        or(
          ilike(requests.productName, searchTerm),
          ilike(requests.description, searchTerm),
          ilike(users.full_name, searchTerm),
          ilike(services.name, searchTerm),
          ilike(colleges.name, searchTerm)
        )
      );
    }

    // Add grouping, ordering and pagination
    const finalQuery = queryBuilder
      .groupBy(
        requests.id,
        users.id,
        services.id,
        colleges.id
      )
      .orderBy(desc(requests.createdAt))
      .limit(limitNum)
      .offset(offset);

    const data = await finalQuery;

    // Build count query separately
    const countQueryBuilder = db
      .select({ count: count() })
      .from(requests);

    if (status && ['open', 'closed', 'pending'].includes(status)) {
      countQueryBuilder.where(eq(requests.status, status as 'open' | 'closed' | 'pending'));
    }

    if (search) {
      const searchTerm = `%${search}%`;
      countQueryBuilder.where(
        or(
          ilike(requests.productName, searchTerm),
          ilike(requests.description, searchTerm),
          ilike(users.full_name, searchTerm),
          ilike(services.name, searchTerm),
          ilike(colleges.name, searchTerm)
        )
      );
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
    console.error('Error fetching requests:', error);
    return c.json({
      success: false,
      error: 'Failed to fetch requests',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

export default app;