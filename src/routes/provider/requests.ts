import { Hono } from 'hono';
import type { Context } from 'hono';
import { db } from '../../drizzle/db.js';
import { requests, providers, colleges, bids, notifications, interests,TSInterests,TSProviders, TSBids, TSRequests, TSUsers , users, services} from '../../drizzle/schema.js';
import { eq, and, lte, gte, sql , desc,count,ilike,or } from 'drizzle-orm';
import {authMiddleware, serviceProviderRoleAuth  } from '../../middleware/bearAuth.js';
import type { CustomContext } from '../../types/context.js';
import { notifyNearbyProviders } from '../../lib/providerNotifications.js';
import { RouteError } from '../../utils/error.js'; 

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
type RequestWithRelations = TSRequests & {
  bids: (TSBids & {
    provider: TSProviders & {
      user: TSUsers | null;
    } | null;
  })[];
  interests: (TSInterests & {
    provider: TSProviders & {
      user: TSUsers | null;
    } | null;
  })[];
};
type QueryOptions = {
  where: any; // (or your specific condition type)
  orderBy: any[]; // replace with your actual orderBy type if needed
  with: {
    bids?: true;
    interests?: {
      with: {
        provider: {
          with: {
            user: true;
          };
        };
      };
    };
    user?: true;
    service?: true;
    college?: true;
  };
};

function tryParseJson(input: any): any {
  if (typeof input !== 'string') return input; // Already parsed or invalid
  try {
    return JSON.parse(input);
  } catch {
    return null;
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

    // Helper function to process location data
    function processLocation(rawLocation: any) {
      if (!rawLocation) return null;

      try {
        // Try to parse as JSON first
        const parsed = JSON.parse(rawLocation);
        
        // Check if it has lat/lng properties
        if (typeof parsed === 'object' && parsed !== null) {
          // Check for empty/zero location
          if (parsed.lat === 0 && parsed.lng === 0 && 
              (!parsed.address || parsed.address === 'Not specified')) {
            return null;
          } else {
            return {
              lat: parsed.lat || null,
              lng: parsed.lng || null,
              address: parsed.address && parsed.address !== 'Not specified' ? parsed.address : null
            };
          }
        } else {
          return null;
        }
      } catch {
        // If JSON parsing fails, treat as plain text address
        return {
          address: rawLocation,
          lat: null,
          lng: null
        };
      }
    }

    // Helper function to format the response data
    function formatResponseData(rows: any[]) {
      if (!rows || !Array.isArray(rows)) {
        console.warn('⚠️ Invalid rows data provided to formatResponseData:', rows);
        return [];
      }

      return rows.map(row => {
        try {
          const location = processLocation(row.raw_location);
          
          // Remove raw_location and ensure created_at is included
          const { raw_location, ...cleanRow } = row;
          
          return {
            ...cleanRow,
            location,
            created_at: row.created_at,
            createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
          };
        } catch (formatError) {
          console.error('❌ Error formatting row:', { row, error: formatError });
          // Return the row with minimal processing if formatting fails
          const { raw_location, ...cleanRow } = row;
          return {
            ...cleanRow,
            location: null,
            created_at: row.created_at,
            createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
          };
        }
      });
    }

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
            r.id,
            r.user_id,
            r.service_id,
            r.product_name as title,
            r.description,
            r.desired_price as budget,
            r.status,
            r.created_at,
            r.college_filter_id,
            r.location as raw_location,
            r.is_service,
            r.allow_interests,
            r.allow_bids,
            r.accepted_bid_id,
            u.email AS user_email,
            u.role AS user_role,
            u.full_name AS user_full_name,
            s.name AS service_name,
            c.name AS college_name,
            (
              SELECT COALESCE(json_agg(b.*) FILTER (WHERE b.id IS NOT NULL), '[]'::json) 
              FROM bids b WHERE b.request_id = r.id
            ) AS bids,
            (
              SELECT COALESCE(json_agg(i.*) FILTER (WHERE i.id IS NOT NULL), '[]'::json) 
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
          showingAllServices: filterByServices !== 'true',
          sampleRow: results.rows?.[0] ? {
            id: results.rows[0].id,
            title: results.rows[0].title,
            budget: results.rows[0].budget,   
            created_at: results.rows[0].created_at,
            raw_location: results.rows[0].raw_location
          } : null
        });

        // Process the results and format location and created_at
        const formattedResults = formatResponseData(results.rows || []);

        console.log('🔄 Formatted results sample:', {
          count: formattedResults.length,
          sampleFormatted: formattedResults[0] ? {
            id: formattedResults[0].id,
            title: formattedResults[0].title,
            created_at: formattedResults[0].created_at,
            createdAt: formattedResults[0].createdAt,
            location: formattedResults[0].location
          } : null
        });

        return c.json(formattedResults);

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

      // Updated location-based query with fixed column names
      const results = await db.execute(sql`
        SELECT 
          r.id,
          r.user_id,
          r.service_id,
          r.product_name as title,
          r.description,
          r.desired_price as budget,
          r.status,
          r.created_at,
          r.college_filter_id,
          r.location as raw_location,
          r.is_service,
          r.allow_interests,
          r.allow_bids,
          r.accepted_bid_id,
          u.email AS user_email,
          u.role AS user_role,
          u.full_name AS user_full_name,
          s.name AS service_name,
          c.name AS college_name,
          (
            SELECT COALESCE(json_agg(b.*) FILTER (WHERE b.id IS NOT NULL), '[]'::json) 
            FROM bids b WHERE b.request_id = r.id
          ) AS bids,
          (
            SELECT COALESCE(json_agg(i.*) FILTER (WHERE i.id IS NOT NULL), '[]'::json) 
            FROM interests i
            LEFT JOIN providers p ON p.id = i.provider_id
            WHERE i.request_id = r.id
          ) AS interests
        FROM requests r
        LEFT JOIN services s ON s.id = r.service_id
        LEFT JOIN colleges c ON c.id = r.college_filter_id
        WHERE r.status = 'open'
          ${serviceFilterCondition}
          ${collegeFilterCondition}
        ORDER BY r.created_at DESC
        LIMIT 200
      `);

      console.log('🔍 Location query executed:', {
        totalFound: results.rows?.length || 0,
        sampleRow: results.rows?.[0] ? {
          id: results.rows[0].id,
          created_at: results.rows[0].created_at,
          raw_location: results.rows[0].raw_location
        } : null
      });

      // Process results and filter by distance in JavaScript
      const processedResults = formatResponseData(results.rows || [])
        .filter(row => {
          try {
            // Only include rows with valid coordinates for distance filtering
            if (!row.location || !row.location.lat || !row.location.lng) {
              console.log('🚫 Skipping row without valid location:', { id: row.id, location: row.location });
              return false; // Skip requests without valid coordinates
            }

            // Calculate distance using Haversine formula
            const R = 6371; // Earth's radius in kilometers
            const dLat = (row.location.lat - numLat) * Math.PI / 180;
            const dLng = (row.location.lng - numLng) * Math.PI / 180;
            const a = 
              Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(numLat * Math.PI / 180) * Math.cos(row.location.lat * Math.PI / 180) * 
              Math.sin(dLng/2) * Math.sin(dLng/2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
            const distance = R * c;

            // Add distance to the result for frontend use
            row.distance = parseFloat(distance.toFixed(2));

            const withinRange = distance <= numRange;
            console.log('📏 Distance calculation:', { 
              id: row.id, 
              distance: row.distance, 
              withinRange,
              maxRange: numRange 
            });

            return withinRange;
          } catch (distanceError) {
            console.error('❌ Error calculating distance for row:', { 
              rowId: row.id, 
              error: distanceError 
            });
            return false;
          }
        })
        .slice(0, 100); // Limit to 100 results

      console.log('✅ Location-based query successful:', {
        totalFound: results.rows?.length || 0,
        afterDistanceFilter: processedResults.length,
        executionTime: Date.now() - startTime
      });

      return c.json(processedResults);

    } catch (dbError) {
      console.error('❌ Database error in location-based query:', dbError);
      throw new RouteError('Location-based database query failed', 500);
    }

  } catch (error: unknown) {
    console.error('💥 Route error occurred:', error);
    
    if (error instanceof RouteError) {
      return c.json({ 
        error: error.message,
        ...(error.context && { details: error.context })
      }, error.statusCode);
    }

    if (error instanceof ValidationError) {
      return c.json({ 
        error: 'Validation failed',
        message: error.message,
        ...(error.field && { field: error.field })
      }, 400);
    }

    return c.json({ 
      error: 'Internal server error',
      ...(process.env.NODE_ENV === 'development' && {
        message: error instanceof Error ? error.message : String(error)
      })
    }, 500);
  }
});

///interests

app.get('/', async (c) => {
  try {
    const user = c.get('user');
    const includeParam = c.req.query('include') || '';
    const shouldIncludeInterests = includeParam.includes('interests');
    const shouldIncludeBids = includeParam.includes('bids');
    
    // Build the query with proper relations - type it as any to avoid TS issues
    const queryOptions: any = {
      where: eq(requests.userId, Number(user.id)),
      orderBy: [desc(requests.createdAt)],
      with: {}
    };

    // Add relations based on include parameter
    if (shouldIncludeBids) {
      queryOptions.with.bids = true;
    }

    if (shouldIncludeInterests) {
      queryOptions.with.interests = {
        with: {
          provider: {
            with: {
              user: true,
            },
          },
        },
      };
    }

    const userRequests = await db.query.requests.findMany(queryOptions);

    return c.json(userRequests); // Return array directly

  } catch (error) {
    console.error('Error fetching requests:', error);
    return c.json({ 
      success: false,
      error: 'Failed to fetch requests',
      details: error instanceof Error ? error.message : String(error)
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