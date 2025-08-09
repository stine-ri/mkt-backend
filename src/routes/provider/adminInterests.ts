import { Hono } from 'hono';
import { db } from '../../drizzle/db';
import { 
  interests, 
  providers, 
  requests, 
  users, 
  services,
  colleges,
  chatRooms
} from '../../drizzle/schema';
import { and, eq, desc, ilike, or, count } from 'drizzle-orm';
import { adminRoleAuth } from '../../middleware/bearAuth';
import type { CustomContext } from '../../types/context';

const app = new Hono<CustomContext>();

// Apply admin auth middleware to all routes
app.use('*', adminRoleAuth);

/**
 * GET /api/admin/interests
 * Get all interests with filtering and pagination
 */
app.get('/', async (c) => {
  const { status, page = 1, limit = 20, search } = c.req.query();

  try {
    // Base query with joins - Flattened structure with aliases
    const query = db.select({
      // Interest fields
      id: interests.id,
      status: interests.status,
      createdAt: interests.createdAt,
      chatRoomId: interests.chatRoomId,
      
      // Provider fields
      providerId: providers.id,
      providerFirstName: providers.firstName,
      providerLastName: providers.lastName,
      providerEmail: users.email,
      
      // College fields
      collegeId: colleges.id,
      collegeName: colleges.name,
      
      // Request fields
      requestId: requests.id,
      productName: requests.productName,
      requestDescription: requests.description,
      requestStatus: requests.status,
      
      // Service fields
      serviceId: services.id,
      serviceName: services.name,
      serviceCategory: services.category,
      
      // User fields (from request)
      userId: users.id,
      userFullName: users.full_name,
      userEmail: users.email
    })
    .from(interests)
    .leftJoin(providers, eq(interests.providerId, providers.id))
    .leftJoin(users, eq(providers.userId, users.id))
    .leftJoin(colleges, eq(providers.collegeId, colleges.id))
    .leftJoin(requests, eq(interests.requestId, requests.id))
    .leftJoin(services, eq(requests.serviceId, services.id))
    .leftJoin(chatRooms, eq(interests.chatRoomId, chatRooms.id))
    .orderBy(desc(interests.createdAt));

    // Apply status filter if provided
    if (status && ['pending', 'accepted', 'rejected'].includes(status)) {
      query.where(eq(interests.status, status));
    }

    // Apply search filter
    if (search) {
      const searchTerm = `%${search}%`;
      query.where(
        or(
          ilike(requests.productName, searchTerm),
          ilike(providers.firstName, searchTerm),
          ilike(providers.lastName, searchTerm),
          ilike(users.email, searchTerm),
          ilike(colleges.name, searchTerm),
          ilike(services.name, searchTerm)
        )
      );
    }

    // Apply pagination
    const pageNum = Number(page) || 1;
    const limitNum = Number(limit) || 20;
    const offset = (pageNum - 1) * limitNum;
    
    query.limit(limitNum).offset(offset);

    const rawResult = await query;

    // Transform the flattened result into nested structure
    const result = rawResult.map(row => ({
      id: row.id,
      status: row.status,
      createdAt: row.createdAt,
      chatRoomId: row.chatRoomId,
      provider: {
        id: row.providerId,
        firstName: row.providerFirstName,
        lastName: row.providerLastName,
        email: row.providerEmail,
        college: {
          id: row.collegeId,
          name: row.collegeName
        }
      },
      request: {
        id: row.requestId,
        productName: row.productName,
        description: row.requestDescription,
        status: row.requestStatus,
        service: {
          id: row.serviceId,
          name: row.serviceName,
          category: row.serviceCategory
        },
        user: {
          id: row.userId,
          full_name: row.userFullName,
          email: row.userEmail
        }
      }
    }));

    // Get total count for pagination
    let total = 0;
    
    if (search) {
      // Count query with joins for search
      const searchTerm = `%${search}%`;
      const countQuery = db.select({ count: count() })
        .from(interests)
        .leftJoin(providers, eq(interests.providerId, providers.id))
        .leftJoin(users, eq(providers.userId, users.id))
        .leftJoin(colleges, eq(providers.collegeId, colleges.id))
        .leftJoin(requests, eq(interests.requestId, requests.id))
        .leftJoin(services, eq(requests.serviceId, services.id));
        
      const whereConditions = [
        or(
          ilike(requests.productName, searchTerm),
          ilike(providers.firstName, searchTerm),
          ilike(providers.lastName, searchTerm),
          ilike(users.email, searchTerm),
          ilike(colleges.name, searchTerm),
          ilike(services.name, searchTerm)
        )
      ];
      
      if (status && ['pending', 'accepted', 'rejected'].includes(status)) {
        whereConditions.push(eq(interests.status, status));
      }
      
      countQuery.where(and(...whereConditions));
      total = await countQuery.then(r => r[0]?.count || 0);
    } else {
      // Simple count query without search
      const countQuery = db.select({ count: count() }).from(interests);
      
      if (status && ['pending', 'accepted', 'rejected'].includes(status)) {
        countQuery.where(eq(interests.status, status));
      }
      
      total = await countQuery.then(r => r[0]?.count || 0);
    }

    return c.json({
      success: true,
      data: result,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    });

  } catch (error) {
    console.error('Error fetching interests:', error);
    return c.json({ 
      success: false,
      error: 'Failed to fetch interests',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

/**
 * GET /api/admin/interests/:id
 * Get interest details by ID
 */
app.get('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (isNaN(id)) return c.json({ error: 'Invalid ID' }, 400);

  try {
    const interest = await db.query.interests.findFirst({
      where: eq(interests.id, id),
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
        },
        chatRoom: true
      }
    });

    if (!interest) {
      return c.json({ error: 'Interest not found' }, 404);
    }

    return c.json(interest);
  } catch (error) {
    console.error('Error fetching interest:', error);
    return c.json({ 
      error: 'Failed to fetch interest',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

/**
 * DELETE /api/admin/interests/:id
 * Admin can delete an interest
 */
app.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (isNaN(id)) return c.json({ error: 'Invalid ID' }, 400);

  try {
    const interest = await db.query.interests.findFirst({
      where: eq(interests.id, id)
    });

    if (!interest) {
      return c.json({ error: 'Interest not found' }, 404);
    }

    await db.delete(interests).where(eq(interests.id, id));

    return c.json({ 
      success: true,
      message: 'Interest deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting interest:', error);
    return c.json({ 
      error: 'Failed to delete interest',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

export default app;