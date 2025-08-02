import { Hono } from 'hono';
import type { Context } from 'hono';
import { db } from '../../drizzle/db.js';
import { requests, providers, colleges, bids, notifications } from '../../drizzle/schema.js';
import { eq, and, lte, gte, sql } from 'drizzle-orm';
import {authMiddleware, serviceProviderRoleAuth  } from '../../middleware/bearAuth.js';
import type { CustomContext } from '../../types/context.js';
import { notifyNearbyProviders } from '../../lib/providerNotifications.js';

const app = new Hono<CustomContext>();


app.use('*', authMiddleware, serviceProviderRoleAuth);

// Get relevant requests for provider// Types for better error handling
interface DatabaseError extends Error {
  code?: string;
  detail?: string;
  constraint?: string;
}

// Custom error classes
class ValidationError extends Error {
  public field?: string;
  public value?: unknown;
  
  constructor(message: string, field?: string, value?: unknown) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
    this.value = value;
  }
}

class RouteError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'RouteError';
  }
}

app.get('/', async (c: Context<CustomContext>) => {
  const startTime = Date.now();
  let userId: number | undefined;
  
  try {
    console.log('🚀 Starting provider requests route');
    
    // Extract and validate user
    const user = c.get('user');
    console.log('👤 User from context:', { 
      id: user?.id, 
      role: user?.role,
      type: typeof user?.id 
    });
    
    if (!user || !user.id) {
      console.error('❌ No user found in context');
      throw new RouteError('User not authenticated', 401);
    }

    userId = Number(user.id);
    if (isNaN(userId)) {
      console.error('❌ Invalid user ID:', { 
        originalId: user.id, 
        convertedId: userId 
      });
      throw new RouteError('Invalid user ID format', 400);
    }

    console.log('✅ User ID validated:', userId);

    // Extract query parameters
    const queryParams = c.req.query();
    const { lat, lng, range = '50', filterByServices = 'false' } = queryParams;
    
    console.log('📍 Query parameters:', { 
      lat, 
      lng, 
      range,
      filterByServices,
      allParams: queryParams 
    });

    // Database query for provider
    console.log('🔍 Fetching provider profile for user:', userId);
    
    const provider = await db.query.providers.findFirst({
      where: eq(providers.userId, userId),
      with: {
        services: {
          with: { service: true }
        }
      }
    });

    console.log('📊 Provider query result:', {
      found: !!provider,
      providerId: provider?.id,
      collegeId: provider?.collegeId,
      servicesCount: provider?.services?.length || 0
    });

    if (!provider) {
      console.warn('⚠️ Provider profile not found for user:', userId);
      return c.json({ error: 'Provider profile not found' }, 404);
    }

    const serviceIds = provider.services.map((s) => s.serviceId);
    console.log('🎯 Service IDs for provider:', serviceIds);

    // Handle requests without location filtering
    if (!lat || !lng) {
      console.log('📍 No coordinates provided, fetching all requests without location filter');
      
      try {
        const serviceFilterCondition = filterByServices === 'true' && serviceIds.length > 0
          ? sql`AND r.service_id IN (${sql.join(serviceIds.map(id => sql`${id}`), sql`,`)})`
          : sql``;

        const collegeFilterCondition = filterByServices === 'true' && provider.collegeId
          ? sql`AND (r.college_filter_id IS NULL OR r.college_filter_id = ${provider.collegeId})`
          : sql``;

        console.log('🔍 Query filters:', {
          serviceFilterApplied: filterByServices === 'true',
          serviceIds: serviceIds,
          collegeFilterApplied: filterByServices === 'true',
          collegeId: provider.collegeId
        });

        const results = await db.execute(sql`
          SELECT 
            r.*, 
            u.email AS user_email, 
            u.role AS user_role,
            s.name AS service_name,
            c.name AS college_name,
            (
              SELECT json_agg(b.*) FROM bids b WHERE b.request_id = r.id
            ) AS bids,
            (
              SELECT json_agg(i.*) 
              FROM interests i
              LEFT JOIN providers p ON p.id = i.provider_id
              WHERE i.request_id = r.id
            ) AS interests
          FROM requests r
          LEFT JOIN users u ON u.user_id = r.user_id
          LEFT JOIN services s ON s.id = r.service_id
          LEFT JOIN colleges c ON c.id = r.college_filter_id
          WHERE r.status = 'open'
            ${serviceFilterCondition}
            ${collegeFilterCondition}
          ORDER BY r.created_at DESC
          LIMIT 100
        `);

        console.log('✅ Non-location query successful:', {
          rowCount: results.rows?.length || 0,
          executionTime: Date.now() - startTime,
          showingAllServices: filterByServices !== 'true'
        });

        return c.json({
          success: true,
          data: results.rows,
          total: results.rows?.length || 0,
          filters: {
            serviceFiltered: filterByServices === 'true',
            collegeFiltered: filterByServices === 'true',
            serviceIds: serviceIds,
            showingAllServices: filterByServices !== 'true'
          }
        });

      } catch (dbError) {
        console.error('❌ Database error in non-location query:', {
          error: dbError,
          serviceIds,
          collegeId: provider.collegeId
        });
        throw new RouteError('Database query failed', 500, { 
          query: 'non-location',
          serviceIds,
          collegeId: provider.collegeId 
        });
      }
    }

    // Handle requests with location filtering
    console.log('📍 Processing location-based query');
    
    // Convert and validate coordinates
    const numLat = parseFloat(lat);
    const numLng = parseFloat(lng);
    const numRange = parseFloat(range);

    // Validate coordinates
    if (isNaN(numLat) || isNaN(numLng) || isNaN(numRange)) {
      throw new ValidationError('Invalid coordinate values', 'coordinates', { lat, lng, range });
    }

    if (numLat < -90 || numLat > 90) {
      throw new ValidationError('Latitude must be between -90 and 90');
    }
    
    if (numLng < -180 || numLng > 180) {
      throw new ValidationError('Longitude must be between -180 and 180');
    }
    
    if (numRange <= 0 || numRange > 10000) {
      throw new ValidationError('Range must be between 0 and 10000 km');
    }

    try {
      const serviceFilterCondition = filterByServices === 'true' && serviceIds.length > 0
        ? sql`AND r.service_id IN (${sql.join(serviceIds.map(id => sql`${id}`), sql`,`)})`
        : sql``;

      const collegeFilterCondition = filterByServices === 'true' && provider.collegeId
        ? sql`AND (r.college_filter_id IS NULL OR r.college_filter_id = ${provider.collegeId})`
        : sql``;

      const results = await db.execute(sql`
        SELECT 
          r.*, 
          u.email AS user_email, 
          u.role AS user_role,
          s.name AS service_name,
          c.name AS college_name,
          (
            SELECT json_agg(b.*) FROM bids b WHERE b.request_id = r.id
          ) AS bids,
          (
            6371 * acos(
              cos(radians(${numLat})) * 
              cos(radians(COALESCE((r.location::json->>'lat')::float, 0))) * 
              cos(radians(COALESCE((r.location::json->>'lng')::float, 0)) - radians(${numLng})) + 
              sin(radians(${numLat})) * 
              sin(radians(COALESCE((r.location::json->>'lat')::float, 0)))
            )
          ) AS distance_km
        FROM requests r
        LEFT JOIN users u ON u.user_id = r.user_id
        LEFT JOIN services s ON s.id = r.service_id
        LEFT JOIN colleges c ON c.id = r.college_filter_id
        WHERE r.status = 'open'
          AND r.location IS NOT NULL
          AND r.location != '{}'
          AND r.location != '\"{}\"'
          AND (
            6371 * acos(
              cos(radians(${numLat})) * 
              cos(radians(COALESCE((r.location::json->>'lat')::float, 0))) * 
              cos(radians(COALESCE((r.location::json->>'lng')::float, 0)) - radians(${numLng})) + 
              sin(radians(${numLat})) * 
              sin(radians(COALESCE((r.location::json->>'lat')::float, 0)))
            )
          ) <= ${numRange}
          ${serviceFilterCondition}
          ${collegeFilterCondition}
        ORDER BY r.created_at DESC
        LIMIT 100
      `);

      return c.json({
        success: true,
        data: results.rows,
        total: results.rows?.length || 0,
        filters: {
          location: { lat: numLat, lng: numLng, range: numRange },
          serviceFiltered: filterByServices === 'true',
          collegeFiltered: filterByServices === 'true',
          serviceIds: serviceIds,
          showingAllServices: filterByServices !== 'true'
        }
      });

    } catch (dbError) {
      console.error('❌ Database error in location-based query:', dbError);
      throw new RouteError('Location-based database query failed', 500);
    }

  } catch (error: unknown) {
    console.error('💥 Route error occurred:', error);
    
    if (error instanceof RouteError) {
     return c.json({ error: error.message }, error.statusCode as 400);

    }

    if (error instanceof ValidationError) {
      return c.json({ 
        error: 'Validation failed',
        message: error.message
      }, 400);
    }

    return c.json({ error: 'Internal server error' }, 500);
  }
});


app.post('/', async (c) => {
  const userId = Number(c.get('user').id);
  const body = await c.req.json();

  // Validate request
  if (body.isService && !body.serviceId) {
    return c.json({ error: 'Service ID is required' }, 400);
  }
  if (!body.isService && !body.productName) {
    return c.json({ error: 'Product name is required' }, 400);
  }

  // Create request
  const [request] = await db.insert(requests).values({
    userId: userId,
    serviceId: body.isService ? Number(body.serviceId) : null,
    productName: !body.isService ? body.productName : null,
    isService: Boolean(body.isService),
    description: body.description,
    desiredPrice: Number(body.desiredPrice),
    location: body.location, // This should be a string matching your varchar(255) column
    collegeFilterId: body.collegeFilterId ? Number(body.collegeFilterId) : null,
    status: 'open'
  }).returning();

  // Notify providers
  await notifyNearbyProviders(request);

  return c.json(request);
});

export default app;