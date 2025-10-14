import { Hono } from 'hono';
import type { Context } from 'hono';
import { db } from '../../drizzle/db.js';
import { requests, providers, colleges, bids, notifications, interests, requestImages, TSInterests, TSProviders, TSBids, TSRequests, TSUsers, users, services } from '../../drizzle/schema.js';
import { eq, and, lte, gte, sql, desc, count, ilike, or } from 'drizzle-orm';
import { authMiddleware, serviceProviderRoleAuth } from '../../middleware/bearAuth.js';
import type { CustomContext } from '../../types/context.js';
import { notifyNearbyProviders } from '../../lib/providerNotifications.js';
import { RouteError } from '../../utils/error.js';
import { uploadToCloudinary, deleteFromCloudinary } from '../../utils/cloudinary.js';
import { FileUploadError } from '../../utils/error.js';

const app = new Hono<CustomContext>();

app.use('*', authMiddleware, serviceProviderRoleAuth);

// Types for better error handling
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
  where: any;
  orderBy: any[];
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

// Define types for the fetchRegularRequests function parameters
interface Provider {
  id: number;
  collegeId?: number | null;
  services?: any[];
}

function tryParseJson(input: any): any {
  if (typeof input !== 'string') return input;
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

// Helper function for regular requests (with proper TypeScript types)
async function fetchRegularRequests(
  provider: Provider,
  serviceIds: number[],
  filterByServices: string,
  lat?: string,
  lng?: string,
  range?: string
) {
  const serviceFilterCondition = filterByServices === 'true' && serviceIds.length > 0
    ? sql`AND r.service_id IN (${sql.join(serviceIds.map(id => sql`${id}`), sql`,`)})`
    : sql``;

  const collegeFilterCondition = filterByServices === 'true' && provider.collegeId
    ? sql`AND (r.college_filter_id IS NULL OR r.college_filter_id = ${provider.collegeId})`
    : sql``;

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

  return results.rows || [];
}

// MAIN PROVIDER REQUESTS ROUTE - Get relevant requests for provider
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

    const providerId = provider.id;
    const serviceIds = provider.services.map((s) => s.serviceId);
    console.log('🎯 Service IDs for provider:', serviceIds);

    // Helper function to process location data
    function processLocation(rawLocation: any) {
      if (!rawLocation) {
        console.log('📍 No raw location data');
        return null;
      }
      // ... rest of your location processing code
      return null;
    }

    // Helper function to format the response data - FIXED: Added cleanRow definition
    function formatResponseData(rows: any[]) {
      return rows.map((row, index) => {
        // Create cleanRow by removing unwanted properties or transforming the row
        const { raw_location, ...cleanRow } = row;
        const location = processLocation(row.raw_location);

        return {
          ...cleanRow,
          location,
          created_at: row.created_at,
          createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
        };
      });
    }

    // NEW: Function to fetch service list requests
   // In your provider requests route - FIXED VERSION
const fetchServiceListRequests = async (providerId: number) => {
  try {
    console.log('🔍 Fetching service list requests for provider:', providerId);
    
    const serviceListRequests = await db.execute(sql`
      SELECT 
        sr.id,
        sr.client_id as user_id,
        sr.service_id,
        sr.request_title as title,
        sr.description,
        COALESCE(sr.budget_min, sr.budget_max, '0') as budget,
        sr.status,
        sr.created_at,
        sr.location as raw_location,
        sr.deadline,
        sr.client_notes,
        true as is_service,
        true as allow_interests,
        true as allow_bids,
        null as accepted_bid_id,
        null as college_filter_id,
        u.email AS user_email,
        u.role AS user_role,
        u.full_name AS user_full_name,
        u.contact_phone as user_phone,
        s.name AS service_name,
        null as college_name,
        '[]'::json AS bids,
        '[]'::json AS interests,
        true as from_service_list,
        sr.provider_id as target_provider_id
      FROM service_requests sr
      LEFT JOIN users u ON u.user_id = sr.client_id
      LEFT JOIN services s ON s.id = sr.service_id
      WHERE sr.provider_id = ${providerId}
        AND sr.status = 'pending'
      ORDER BY sr.created_at DESC
      LIMIT 50
    `);

    console.log('✅ Service list requests fetched:', {
      count: serviceListRequests.rows?.length || 0
    });

    return serviceListRequests.rows || [];
  } catch (error) {
    console.error('❌ Error fetching service list requests:', error);
    return [];
  }
};

    // Fetch both regular requests and service list requests
    const [regularRequests, serviceListRequestsData] = await Promise.all([
      fetchRegularRequests(provider, serviceIds, filterByServices, lat, lng, range),
      fetchServiceListRequests(providerId)
    ]);

    // Process and combine both types of requests
    const processedRegularRequests = formatResponseData(regularRequests || []);
    const processedServiceListRequests = formatResponseData(serviceListRequestsData || []);

    // Add source identifier to service list requests
    const serviceListRequestsWithSource = processedServiceListRequests.map(req => ({
      ...req,
      requestSource: 'service_list',
      originalRequestType: 'service_list'
    }));

    // Combine both request types
    const allRequests = [...processedRegularRequests, ...serviceListRequestsWithSource];

    console.log('📊 Combined requests summary:', {
      regularRequests: processedRegularRequests.length,
      serviceListRequests: processedServiceListRequests.length,
      total: allRequests.length
    });

    return c.json(allRequests);

  } catch (error: unknown) {
    console.error('💥 Route error occurred:', error);
    // Your existing error handling...
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// USER REQUESTS ROUTE - Get user's own requests with interests/bids
app.get('/my-requests', async (c) => {
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

// CREATE REQUEST ROUTE
app.post('/', async (c) => {
  const userId = Number(c.get('user').id);
  
  let body: any;
  let imageFiles: File[] = [];
  
  // ========== COMPREHENSIVE REQUEST ANALYSIS ==========
  console.log('\n🔍 ==================== REQUEST ANALYSIS ====================');
  console.log('📋 Basic Info:');
  console.log('   User ID:', userId);
  console.log('   Method:', c.req.method);
  console.log('   URL:', c.req.url);
  console.log('   Timestamp:', new Date().toISOString());
  
  // Log ALL headers
  console.log('\n📨 ALL REQUEST HEADERS:');
  const headers = c.req.header();
  Object.entries(headers).forEach(([key, value]) => {
    console.log(`   ${key}: ${value}`);
  });
  
  // Get the raw content type header
  const contentType = c.req.header('content-type') || '';
  const contentLength = c.req.header('content-length') || 'unknown';
  
  console.log('\n🎯 KEY HEADERS:');
  console.log('   Content-Type:', contentType);
  console.log('   Content-Length:', contentLength);
  console.log('   User-Agent:', c.req.header('user-agent') || 'unknown');
  console.log('   Origin:', c.req.header('origin') || 'unknown');
  console.log('   Referer:', c.req.header('referer') || 'unknown');
  
  // Check for boundary in multipart
  const boundaryMatch = contentType.match(/boundary=([^;]+)/);
  if (boundaryMatch) {
    console.log('   Multipart Boundary:', boundaryMatch[1]);
  }
  
  // More robust multipart detection
  const isMultipart = contentType.toLowerCase().includes('multipart/form-data') || 
                     contentType.toLowerCase().startsWith('multipart/');
  
  console.log('\n🔍 CONTENT TYPE ANALYSIS:');
  console.log('   Raw Content-Type:', `"${contentType}"`);
  console.log('   Is Multipart Detected:', isMultipart);
  console.log('   Content-Type Length:', contentType.length);
  console.log('   Content-Type includes "multipart":', contentType.toLowerCase().includes('multipart'));
  console.log('   Content-Type starts with "multipart/":', contentType.toLowerCase().startsWith('multipart/'));
  
  // ========== RAW BODY INSPECTION ==========
  console.log('\n📄 RAW BODY INSPECTION:');
  
  let rawBodyText = '';
  let rawBodyBuffer: ArrayBuffer | null = null;
  
  try {
    // Get raw body as text first for inspection
    rawBodyText = await c.req.text();
    console.log('   Raw body length:', rawBodyText.length);
    console.log('   Raw body type:', typeof rawBodyText);
    
    if (rawBodyText.length === 0) {
      console.log('   ⚠️ WARNING: Body is completely empty!');
    } else {
      // Show first and last 100 characters
      console.log('   First 200 chars:', JSON.stringify(rawBodyText.substring(0, 200)));
      if (rawBodyText.length > 200) {
        console.log('   Last 100 chars:', JSON.stringify(rawBodyText.substring(rawBodyText.length - 100)));
      }
      
      // Character analysis
      const firstChar = rawBodyText.charAt(0);
      const lastChar = rawBodyText.charAt(rawBodyText.length - 1);
      console.log('   First character:', JSON.stringify(firstChar), `(ASCII: ${firstChar.charCodeAt(0)})`);
      console.log('   Last character:', JSON.stringify(lastChar), `(ASCII: ${lastChar.charCodeAt(0)})`);
      
      // Check for common patterns
      console.log('   Starts with "{":', rawBodyText.startsWith('{'));
      console.log('   Starts with "[":', rawBodyText.startsWith('['));
      console.log('   Starts with "-":', rawBodyText.startsWith('-'));
      console.log('   Contains "Content-Disposition":', rawBodyText.includes('Content-Disposition'));
      console.log('   Contains "form-data":', rawBodyText.includes('form-data'));
      console.log('   Contains boundary:', boundaryMatch ? rawBodyText.includes(boundaryMatch[1]) : false);
      
      // Check for binary data indicators
      const binaryPattern = /[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F-\xFF]/;
      const hasBinaryData = binaryPattern.test(rawBodyText);
      console.log('   Contains binary data:', hasBinaryData);
    }
  } catch (textError) {
    console.error('   ❌ Error reading raw body as text:', textError);
    
    try {
      // Try as ArrayBuffer if text fails
      rawBodyBuffer = await c.req.arrayBuffer();
      console.log('   Raw body as ArrayBuffer length:', rawBodyBuffer.byteLength);
      
      if (rawBodyBuffer.byteLength > 0) {
        const uint8Array = new Uint8Array(rawBodyBuffer);
        console.log('   First 20 bytes:', Array.from(uint8Array.slice(0, 20)).map(b => `0x${b.toString(16).padStart(2, '0')}`).join(' '));
      }
    } catch (bufferError) {
      console.error('   ❌ Error reading raw body as ArrayBuffer:', bufferError);
    }
  }
  
  // ========== PROCESSING LOGIC ==========
  console.log('\n⚙️ PROCESSING DECISION:');
  console.log('   Will process as multipart:', isMultipart);
  console.log('   Will process as JSON:', !isMultipart);
  
  if (isMultipart) {
    console.log('\n📦 PROCESSING AS MULTIPART/FORM-DATA...');
    
    try {
      // Create a new request with the original body for formData()
      const newRequest = new Request(c.req.url, {
        method: c.req.method,
        headers: c.req.header(),
        body: rawBodyText || rawBodyBuffer
      });
      
      const formData = await newRequest.formData();
      
      if (!formData) {
        console.error('❌ FormData is null or undefined');
        return c.json({ 
          error: 'Failed to parse form data - no data received',
          contentType: contentType,
          debugInfo: {
            rawBodyLength: rawBodyText.length,
            hasRawBody: rawBodyText.length > 0,
            contentType: contentType
          }
        }, 400);
      }
      
      // Debug: Log all entries
      console.log('\n📋 FORM DATA ENTRIES:');
      const entries = Array.from(formData.entries());
      console.log('   Total form entries:', entries.length);
      
      if (entries.length === 0) {
        console.log('   ⚠️ WARNING: No form entries found!');
      }
      
      entries.forEach(([key, value], index) => {
        console.log(`   Entry ${index + 1}:`);
        console.log(`     Key: "${key}"`);
        if (value instanceof File) {
          console.log(`     Value: File {
        name: "${value.name}",
        size: ${value.size} bytes,
        type: "${value.type}",
        lastModified: ${value.lastModified}
      }`);
        } else {
          console.log(`     Value: "${value}" (${typeof value})`);
        }
      });
      
      // Extract form fields with null checks
      body = {
        productName: formData.get('productName')?.toString() || null,
        description: formData.get('description')?.toString() || null,
        desiredPrice: formData.get('desiredPrice')?.toString() || null,
        isService: formData.get('isService')?.toString() === 'true',
        serviceId: formData.get('serviceId')?.toString() || null,
        location: formData.get('location')?.toString() || null,
        collegeFilterId: formData.get('collegeFilterId')?.toString() || null
      };
      
      console.log('\n📋 EXTRACTED BODY FROM FORMDATA:');
      console.log(JSON.stringify(body, null, 2));
      
      // Extract images with enhanced validation
      const rawImageFiles = formData.getAll('images');
      console.log(`\n🖼️ IMAGE PROCESSING:`);
      console.log(`   Raw image files count: ${rawImageFiles.length}`);
      
      if (rawImageFiles.length === 0) {
        console.log('   Checking for single image field...');
        const singleImage = formData.get('image');
        if (singleImage instanceof File) {
          rawImageFiles.push(singleImage);
          console.log('   ✓ Found single image file');
        } else {
          console.log('   ℹ️ No single image field found either');
        }
      }
      
      // Filter and validate images
      imageFiles = rawImageFiles.filter((file): file is File => {
        if (!(file instanceof File)) {
          console.warn(`   ⚠️ Non-file object found in images:`, typeof file);
          return false;
        }
        
        if (file.size === 0) {
          console.warn(`   ⚠️ Empty file detected: ${file.name}`);
          return false;
        }
        
        if (file.size > 5 * 1024 * 1024) { // 5MB limit
          console.warn(`   ⚠️ File too large: ${file.name} (${file.size} bytes)`);
          return false;
        }
        
        if (!file.type.startsWith('image/')) {
          console.warn(`   ⚠️ Non-image file detected: ${file.name} (${file.type})`);
          return false;
        }
        
        console.log(`   ✓ Valid image: ${file.name} (${file.size} bytes, ${file.type})`);
        return true;
      });
      
      console.log(`   Final valid image files: ${imageFiles.length}/${rawImageFiles.length}`);
      
    } catch (formDataError) {
      console.error('\n❌ FORMDATA PARSING ERROR:', formDataError);
      console.error('   Error name:', formDataError instanceof Error ? formDataError.name : 'Unknown');
      console.error('   Error message:', formDataError instanceof Error ? formDataError.message : 'Unknown');
      console.error('   Error stack:', formDataError instanceof Error ? formDataError.stack : 'Unknown');
      
      return c.json({ 
        error: 'Failed to parse form data', 
        details: formDataError instanceof Error ? formDataError.message : 'Unknown error',
        contentType: contentType,
        debugInfo: {
          rawBodyLength: rawBodyText.length,
          rawBodyPreview: rawBodyText.substring(0, 200),
          hasContentType: !!contentType,
          hasBoundary: !!boundaryMatch
        },
        timestamp: new Date().toISOString()
      }, 400);
    }
  } else {
    console.log('\n📄 PROCESSING AS JSON...');
    
    try {
      console.log('   Raw body length:', rawBodyText.length);
      console.log('   Raw body preview (first 200 chars):', JSON.stringify(rawBodyText.substring(0, 200)));
      
      if (!rawBodyText || rawBodyText.trim() === '') {
        console.log('   ❌ Request body is empty');
        return c.json({ 
          error: 'Request body is empty',
          contentType: contentType,
          debugInfo: {
            bodyLength: rawBodyText.length,
            bodyType: typeof rawBodyText,
            trimmedLength: rawBodyText.trim().length
          },
          timestamp: new Date().toISOString()
        }, 400);
      }
      
      // Additional validation for JSON format
      const trimmed = rawBodyText.trim();
      if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
        console.error('   ❌ Body does not appear to be JSON. First 100 chars:', JSON.stringify(trimmed.substring(0, 100)));
        return c.json({ 
          error: 'Invalid JSON format - body does not start with { or [',
          bodyPreview: trimmed.substring(0, 200),
          contentType: contentType,
          debugInfo: {
            firstChar: trimmed.charAt(0),
            firstCharCode: trimmed.charCodeAt(0),
            startsWithBrace: trimmed.startsWith('{'),
            startsWithBracket: trimmed.startsWith('['),
            actualStart: JSON.stringify(trimmed.substring(0, 10))
          }
        }, 400);
      }
      
      console.log('   Attempting to parse JSON...');
      body = JSON.parse(rawBodyText);
      console.log('   ✓ JSON parsed successfully');
      console.log('   Parsed JSON body:', JSON.stringify(body, null, 2));
      
    } catch (jsonError) {
      console.error('\n❌ JSON PARSING ERROR:', jsonError);
      console.error('   Error name:', jsonError instanceof Error ? jsonError.name : 'Unknown');
      console.error('   Error message:', jsonError instanceof Error ? jsonError.message : 'Unknown');
      console.error('   Failed to parse body as JSON. Content-Type:', contentType);
      
      // Enhanced error analysis
      if (jsonError instanceof SyntaxError) {
        const errorMessage = jsonError.message;
        console.error('   Syntax error details:', errorMessage);
        
        // Extract position information if available
        const positionMatch = errorMessage.match(/at position (\d+)/);
        if (positionMatch) {
          const position = parseInt(positionMatch[1]);
          console.error('   Error at position:', position);
          if (position < rawBodyText.length) {
            const errorContext = rawBodyText.substring(Math.max(0, position - 10), position + 10);
            console.error('   Context around error:', JSON.stringify(errorContext));
            console.error('   Character at error position:', JSON.stringify(rawBodyText.charAt(position)));
          }
        }
      }
      
      // Check if this might be FormData that wasn't detected
      const looksLikeFormData = rawBodyText.includes('Content-Disposition') || 
                               rawBodyText.includes('form-data') ||
                               (boundaryMatch && rawBodyText.includes(boundaryMatch[1]));
      
      if (looksLikeFormData) {
        console.error('   🤔 Body appears to be FormData but Content-Type suggests JSON');
        return c.json({ 
          error: 'Content type mismatch',
          details: 'The request body appears to be FormData but Content-Type header suggests JSON processing',
          contentType: contentType,
          suggestion: 'Check that the frontend is setting the correct Content-Type header for FormData (should include "multipart/form-data")',
          debugInfo: {
            bodyPreview: rawBodyText.substring(0, 300),
            containsContentDisposition: rawBodyText.includes('Content-Disposition'),
            containsFormData: rawBodyText.includes('form-data'),
            detectedBoundary: boundaryMatch ? boundaryMatch[1] : null
          }
        }, 400);
      }
      
      return c.json({ 
        error: 'Invalid JSON format',
        details: jsonError instanceof Error ? jsonError.message : 'Unknown error',
        contentType: contentType,
        debugInfo: {
          bodyLength: rawBodyText.length,
          bodyPreview: rawBodyText.substring(0, 200),
          firstChar: rawBodyText.charAt(0),
          lastChar: rawBodyText.charAt(rawBodyText.length - 1),
          errorType: jsonError instanceof Error ? jsonError.name : 'Unknown'
        },
        timestamp: new Date().toISOString()
      }, 400);
    }
  }

  // ========== VALIDATION ==========
  console.log('\n✅ VALIDATION PHASE:');
  const validationErrors: string[] = [];
  
  console.log('   Validating request data...');
  console.log('   Body structure:', {
    hasProductName: !!body.productName,
    hasServiceId: !!body.serviceId,
    hasDesiredPrice: !!body.desiredPrice,
    hasLocation: !!body.location,
    isService: body.isService
  });
  
  if (body.isService) {
    if (!body.serviceId || isNaN(Number(body.serviceId))) {
      validationErrors.push('Valid service ID is required for service requests');
      console.log('   ❌ Service ID validation failed:', body.serviceId);
    } else {
      console.log('   ✓ Service ID valid:', body.serviceId);
    }
  } else {
    if (!body.productName || typeof body.productName !== 'string' || body.productName.trim() === '') {
      validationErrors.push('Product name is required for product requests');
      console.log('   ❌ Product name validation failed:', body.productName);
    } else {
      console.log('   ✓ Product name valid:', body.productName);
    }
  }
  
  if (!body.desiredPrice || isNaN(Number(body.desiredPrice)) || Number(body.desiredPrice) < 0) {
    validationErrors.push('Valid desired price is required (must be a positive number)');
    console.log('   ❌ Desired price validation failed:', body.desiredPrice);
  } else {
    console.log('   ✓ Desired price valid:', body.desiredPrice);
  }
  
  if (!body.location || typeof body.location !== 'string' || body.location.trim() === '') {
    validationErrors.push('Location is required');
    console.log('   ❌ Location validation failed:', body.location);
  } else {
    console.log('   ✓ Location valid:', body.location);
  }
  
  if (validationErrors.length > 0) {
    console.log('\n❌ VALIDATION FAILED:');
    validationErrors.forEach((error, index) => {
      console.log(`   ${index + 1}. ${error}`);
    });
    
    return c.json({ 
      error: 'Validation failed', 
      details: validationErrors,
      receivedData: {
        isService: body.isService,
        hasProductName: !!body.productName,
        hasServiceId: !!body.serviceId,
        hasDesiredPrice: !!body.desiredPrice,
        hasLocation: !!body.location,
        imageCount: imageFiles.length
      },
      debugInfo: {
        contentType: contentType,
        processingMethod: isMultipart ? 'multipart' : 'json',
        bodyKeys: Object.keys(body || {})
      }
    }, 400);
  }
  
  console.log('   ✅ All validations passed!');

  let requestId: number | null = null;
  
  try {
    // Create request with enhanced error handling
    const insertData = {
      userId: userId,
      serviceId: body.isService ? Number(body.serviceId) : null,
      productName: !body.isService ? body.productName.toString().trim() : null,
      isService: Boolean(body.isService),
      description: body.description ? body.description.toString().trim() : null,
      desiredPrice: Number(body.desiredPrice),
      location: body.location.toString().trim(),
      collegeFilterId: body.collegeFilterId ? Number(body.collegeFilterId) : null,
      status: 'open' as const
    };

    console.log('\n💾 DATABASE INSERT:');
    console.log('   Insert data:', JSON.stringify(insertData, null, 2));
    
    // Database insert with error handling
    try {
      const [request] = await db.insert(requests).values(insertData).returning();
      
      if (!request || !request.id) {
        throw new Error('Database insert failed - no request returned');
      }
      
      requestId = request.id;
      console.log(`   ✅ Request created with ID: ${requestId}`);
      
    } catch (dbInsertError) {
      console.error('   ❌ Database insert error:', dbInsertError);
      throw new Error(`Failed to create request in database: ${dbInsertError instanceof Error ? dbInsertError.message : 'Unknown error'}`);
    }

    // Handle image uploads
    if (imageFiles.length > 0) {
      console.log(`\n🖼️ IMAGE UPLOAD PROCESS:`);
      console.log(`   Starting upload of ${imageFiles.length} images...`);
      
      try {
        const uploadResults = await Promise.allSettled(
          imageFiles.map(async (file, index) => {
            console.log(`   Uploading image ${index + 1}/${imageFiles.length}: ${file.name}...`);
            
            try {
              // Validate file before upload
              if (!file.name) {
                throw new Error('File has no name');
              }
              
              const folderPath = `users/${userId}/requests/${requestId}`;
              const result = await uploadToCloudinary(file, folderPath, c);
              
              if (!result || !result.url) {
                throw new Error('Upload failed - no URL returned');
              }
              
              console.log(`   ✅ Image ${index + 1} uploaded: ${result.url}`);
              return result;
              
            } catch (uploadError) {
              console.error(`   ❌ Image ${index + 1} upload failed:`, uploadError);
              throw new Error(`Upload failed for ${file.name}: ${uploadError instanceof Error ? uploadError.message : 'Unknown error'}`);
            }
          })
        );

        // Process upload results
        const successful = uploadResults.filter(r => r.status === 'fulfilled');
        const failed = uploadResults.filter(r => r.status === 'rejected');
        
        console.log(`   Upload summary: ${successful.length} successful, ${failed.length} failed`);
        
        if (failed.length > 0) {
          console.log('   Failed uploads:');
          failed.forEach((result, index) => {
            if (result.status === 'rejected') {
              console.log(`     ${index + 1}: ${result.reason}`);
            }
          });
        }

        // Save successful uploads to database
        if (successful.length > 0) {
          try {
            const imageRecords = successful
              .filter((result): result is PromiseFulfilledResult<any> => result.status === 'fulfilled')
              .map(result => {
                const { url, public_id } = result.value;
                return {
                  requestId: requestId!,
                  url,
                  publicId: public_id
                };
              });
            
            console.log(`   Saving ${imageRecords.length} image records to database...`);
            await db.insert(requestImages).values(imageRecords);
            console.log('   ✅ Image records saved');
            
          } catch (dbImageError) {
            console.error('   ❌ Failed to save image records:', dbImageError);
            // Don't fail the entire request for image record errors
          }
        }
        
      } catch (imageProcessError) {
        console.error('   ❌ Image processing error:', imageProcessError);
        // Don't fail the entire request for image processing errors
      }
    } else {
      console.log('\n🖼️ No images to upload');
    }

    // Fetch complete request with images
    let completeRequest: any;
    try {
      completeRequest = await db.query.requests.findFirst({
        where: eq(requests.id, requestId),
        with: {
          images: {
            columns: {
              url: true
            }
          }
        }
      });
      
      if (!completeRequest) {
        throw new Error('Failed to retrieve created request');
      }
      
    } catch (fetchError) {
      console.error('   ❌ Error fetching complete request:', fetchError);
      // Return basic request info if fetch fails
      completeRequest = { 
        id: requestId, 
        images: [] as { url: string }[],
        userId,
        status: 'open' as const,
        isService: body.isService,
        desiredPrice: Number(body.desiredPrice),
        location: body.location.toString().trim(),
        createdAt: new Date()
      };
    }

    // Construct response with proper image mapping
    const response = {
      ...completeRequest,
      images: (completeRequest?.images || []).map((img: any) => img.url)
    };
    
    console.log('\n🎉 FINAL RESPONSE:');
    console.log(`   Request ID: ${response.id}`);
    console.log(`   Images: ${response.images?.length || 0}`);
    if (response.images && response.images.length > 0) {
      response.images.forEach((url: string, index: number) => {
        console.log(`     Image ${index + 1}: ${url}`);
      });
    }

    // Notify providers (with error handling)
    try {
      await notifyNearbyProviders(completeRequest);
      console.log('   ✅ Provider notifications sent');
    } catch (notifyError) {
      console.error('   ❌ Provider notification failed:', notifyError);
      // Don't fail the request creation for notification errors
    }
    
    console.log('🔍 ==================== END REQUEST ANALYSIS ====================\n');

    return c.json(response);

  } catch (error) {
    console.error('\n🚨 ==================== ERROR IN REQUEST CREATION ====================');
    console.error('Error details:', error);
    console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    
    // Enhanced cleanup on error
    if (requestId) {
      console.log('   🧹 Performing cleanup for failed request...');
      try {
        // Delete request and associated images
        const imagesToDelete = await db.query.requestImages.findMany({
          where: eq(requestImages.requestId, requestId),
          columns: { publicId: true }
        });
        
        const cleanupPromises: Promise<any>[] = [
          db.delete(requests).where(eq(requests.id, requestId))
        ];
        
        // Add Cloudinary cleanup if images exist
        if (imagesToDelete.length > 0) {
          const imageCleanupPromises = imagesToDelete.map(img => 
            img.publicId ? deleteFromCloudinary(img.publicId, c) : Promise.resolve()
          );
          cleanupPromises.push(...imageCleanupPromises);
        }
        
        await Promise.allSettled(cleanupPromises);
        console.log('   ✅ Cleanup completed');
      } catch (cleanupError) {
        console.error('   ❌ Cleanup failed:', cleanupError);
      }
    }
    
    console.log('🚨 ==================== END ERROR ANALYSIS ====================\n');
    
    return c.json({ 
      error: 'Internal server error',
      message: 'Something went wrong',
      timestamp: new Date().toISOString(),
      ...(process.env.NODE_ENV === 'development' && {
        details: error instanceof Error ? error.message : String(error),
        debugInfo: {
          contentType: contentType,
          bodyLength: rawBodyText?.length || 0,
          processingMethod: isMultipart ? 'multipart' : 'json'
        }
      })
    }, 500);
  }
});

export default app;