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
    const { lat, lng, range = '50' } = queryParams;
    
    console.log('📍 Query parameters:', { 
      lat, 
      lng, 
      range,
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
    ${serviceIds.length > 0 
      ? sql`AND r.service_id IN (${sql.join(serviceIds.map(id => sql`${id}`), sql`,`)})`
      : sql``}
    AND (
      r.college_filter_id IS NULL OR r.college_filter_id = ${provider.collegeId}
    )
`);



        console.log('✅ Non-location query successful:', {
          rowCount: results.rows?.length || 0,
          executionTime: Date.now() - startTime
        });

        return c.json(results.rows);

      } catch (dbError) {
        console.error('❌ Database error in non-location query:', {
          error: dbError,
          serviceIds,
          collegeId: provider.collegeId,
          sqlParams: { serviceIds, collegeId: provider.collegeId }
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

    console.log('🧮 Coordinate conversion:', {
      original: { lat, lng, range },
      converted: { numLat, numLng, numRange },
      valid: {
        lat: !isNaN(numLat),
        lng: !isNaN(numLng),
        range: !isNaN(numRange)
      }
    });

    // Validate coordinates
    if (isNaN(numLat) || isNaN(numLng) || isNaN(numRange)) {
      console.error('❌ Coordinate validation failed:', {
        lat: { value: lat, parsed: numLat, valid: !isNaN(numLat) },
        lng: { value: lng, parsed: numLng, valid: !isNaN(numLng) },
        range: { value: range, parsed: numRange, valid: !isNaN(numRange) }
      });
      
      throw new ValidationError('Invalid coordinate values', 'coordinates', { lat, lng, range });
    }

    // Additional coordinate range validation
    if (numLat < -90 || numLat > 90) {
      console.error('❌ Latitude out of range:', numLat);
      throw new ValidationError('Latitude must be between -90 and 90');
    }
    
    if (numLng < -180 || numLng > 180) {
      console.error('❌ Longitude out of range:', numLng);
      throw new ValidationError('Longitude must be between -180 and 180');
    }
    
    if (numRange <= 0 || numRange > 10000) {
      console.error('❌ Range out of bounds:', numRange);
      throw new ValidationError('Range must be between 0 and 10000 km');
    }

    console.log('✅ Coordinates validated successfully');

    try {
      console.log('🔍 Executing location-based database query:', {
        center: { lat: numLat, lng: numLng },
        range: numRange,
        serviceIds,
        collegeId: provider.collegeId
      });

      const results = await db.execute(sql`
        SELECT 
          r.*, 
          u.email AS user_email, u.role AS user_role,
          s.name AS service_name,
          c.name AS college_name,
          (
            SELECT json_agg(b.*) FROM bids b WHERE b.request_id = r.id
          ) AS bids
        FROM requests r
        LEFT JOIN users u ON u.user_id = r.user_id
        LEFT JOIN services s ON s.id = r.service_id
        LEFT JOIN colleges c ON c.id = r.college_filter_id
        WHERE r.status = 'open'
          AND (
            6371 * acos(
              cos(radians(${numLat})) * 
              cos(radians((r.location::json->>'lat')::float)) * 
              cos(radians((r.location::json->>'lng')::float) - radians(${numLng})) + 
              sin(radians(${numLat})) * 
              sin(radians((r.location::json->>'lat')::float))
            )
          ) <= ${numRange}
          ${serviceIds.length > 0 
            ? sql`AND r.service_id IN (${sql.join(serviceIds.map(id => sql`${id}`), sql`,`)})`
            : sql``}
          AND (
            r.college_filter_id IS NULL OR r.college_filter_id = ${provider.collegeId}
          )
      `);

      console.log('✅ Location-based query successful:', {
        rowCount: results.rows?.length || 0,
        executionTime: Date.now() - startTime,
        queryParams: { numLat, numLng, numRange, serviceIds }
      });

      return c.json(results.rows);

    } catch (dbError) {
      console.error('❌ Database error in location-based query:', {
        error: dbError,
        coordinates: { numLat, numLng, numRange },
        serviceIds,
        collegeId: provider.collegeId,
        sqlParams: { numLat, numLng, numRange, serviceIds, collegeId: provider.collegeId }
      });
      
      // Check if it's a specific database error
      const dbErr = dbError as DatabaseError;
      if (dbErr.code) {
        console.error('🔍 Database error details:', {
          code: dbErr.code,
          detail: dbErr.detail,
          constraint: dbErr.constraint
        });
      }
      
      throw new RouteError('Location-based database query failed', 500, { 
        query: 'location-based',
        coordinates: { numLat, numLng, numRange },
        serviceIds,
        collegeId: provider.collegeId 
      });
    }

  } catch (error: unknown) {
    const executionTime = Date.now() - startTime;
    
    console.error('💥 Route error occurred:', {
      executionTime,
      userId,
      errorType: error?.constructor?.name,
      timestamp: new Date().toISOString()
    });

    // Handle different error types
    if (error instanceof RouteError) {
      console.error('🎯 RouteError details:', {
        message: error.message,
        statusCode: error.statusCode,
        context: error.context,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
      
      return c.json({ 
        error: error.message,
        ...(process.env.NODE_ENV === 'development' && { 
          context: error.context,
          stack: error.stack 
        })
      }, error.statusCode as any);
    }

    if (error instanceof ValidationError) {
      console.error('📝 ValidationError details:', {
        message: error.message,
        field: error.field,
        value: error.value,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
      
      return c.json({ 
        error: 'Validation failed',
        message: error.message,
        ...(process.env.NODE_ENV === 'development' && { 
          field: error.field,
          value: error.value 
        })
      }, 400);
    }

    // Handle standard errors
    const err = error as Error;
    if (err && typeof err === 'object' && 'message' in err) {
      console.error('⚡ Standard Error details:', {
        name: err.name,
        message: err.message,
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
      });
      
      // Check if it's a database-related error
      const dbErr = err as DatabaseError;
      if (dbErr.code || dbErr.detail) {
        console.error('💾 Database error specifics:', {
          code: dbErr.code,
          detail: dbErr.detail,
          constraint: dbErr.constraint
        });
      }
      
      return c.json({ 
        error: 'Internal server error',
        ...(process.env.NODE_ENV === 'development' && {
          message: err.message,
          name: err.name,
          ...(dbErr.code && { dbCode: dbErr.code }),
          ...(dbErr.detail && { dbDetail: dbErr.detail })
        })
      }, 500);
    }

    // Handle unknown error types
    console.error('❓ Unknown error type:', {
      error,
      type: typeof error,
      stringified: String(error)
    });

    return c.json({ 
      error: 'Internal server error',
      ...(process.env.NODE_ENV === 'development' && { 
        unknownError: String(error),
        type: typeof error 
      })
    }, 500);
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