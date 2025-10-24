// src/routes/client.ts
import { Hono } from 'hono';
import { eq, and, sql, desc } from 'drizzle-orm';
import { InferSelectModel } from 'drizzle-orm';
import { db } from '../../drizzle/db.js';
import { TSRequestsWithRelations, TSRequests,TSInterests, TSProviders ,requestImages} from '../../drizzle/schema.js';
import { drizzle } from 'drizzle-orm/node-postgres';

import {
  requests,
  bids,
  services,
  colleges,
  notifications, 
} from '../../drizzle/schema.js';

import { authMiddleware, clientRoleAuth } from '../../middleware/bearAuth.js';
import { normalizeUrl } from '../../utilis/normalizeUrl.js'; 
import { uploadToCloudinary, deleteFromCloudinary } from '../../utilis/cloudinary.js';
import { isAfter, subDays } from 'date-fns';

const app = new Hono()
  .use('*', authMiddleware)
  .use('*', clientRoleAuth);

// Infer models
type Request = InferSelectModel<typeof requests>;
type Service = InferSelectModel<typeof services>;
type College = InferSelectModel<typeof colleges>;
type Bid = InferSelectModel<typeof bids>;

type RequestWithRelations = Request & {
  service?: Service;
  college?: College;
  bids?: Bid[];
};
// Fixed request handler
// Helper type for the query result
type QueryResult = {
  id: number;
  userId: number | null;
  serviceId: number | null;
  productName: string | null;
  isService: boolean;
  description: string | null;
  desiredPrice: number;
  location: string;
  collegeFilterId: number | null;
   status: "open" | "closed" | "pending" | null;
  allowInterests: boolean | null;
  allowBids: boolean | null;
  accepted_bid_id: number | null;
  expiresAt: Date | null;  // Add new column
  archivedAt: Date | null;  // Add new column
  archivedByClient: boolean | null;  // Add new column
  createdAt: Date | null;
  // Add images type
  images?: Array<{
    id: number;
    requestId: number;
    url: string;
    publicId: string | null;
    createdAt: Date | null;
  }>;
  service?: {
    id: number;
    name: string;
    category: string | null;
    description: string | null;
    createdAt: Date | null;
  } | null;
  college?: {
    id: number;
    name: string;
    location: string | null;
    createdAt: Date | null;
  } | null;
  bids?: Array<{
    id: number;
    userId: number | null;
    requestId: number;
    providerId: number | null;
    price: number;
    message: string | null;
    status: "pending" | "accepted" | "rejected" | null;
    isGraduateOfRequestedCollege: boolean;
    createdAt: Date | null;
  }>;
  interests?: Array<{
    id: number;
    requestId: number | null;
    providerId: number | null;
    message: string | null;
    status: string;
    isShortlisted: boolean | null;
    chatRoomId?: number | null; 
    createdAt: Date | null;
    provider?: {
      id: number;
      userId: number;
      firstName: string;
      lastName: string;
      phoneNumber: string;
      collegeId: number | null;
      latitude: string | null;
      longitude: string | null;
      address: string | null;
      bio: string | null;
      isProfileComplete: boolean | null;
      rating: number | null;
      completedRequests: number | null;
      profileImageUrl: string | null;
      createdAt: Date | null;
      updatedAt: Date | null;
      user?: {
        id: number;
        full_name: string;
        email: string;
        contact_phone: string | null;
        address: string | null;
        avatar: string | null;
        role: "admin" | "service_provider" | "client";
        created_at: Date | null;
        updated_at: Date | null;
      } | null;
    } | null;
  }>;
};

// Fixed request handler
app.get('/requests',  async (c) => {
  const user = c.get('user');
  console.log('User from context:', user); 
  const userId = Number(user.id);
  const includeParam = c.req.query('include') || '';

  if (isNaN(userId)) {
    return c.json({ error: 'Invalid user ID' }, 400);
  }

  try {
    // Build the query with proper typing
  
const queryOptions = {
  where: eq(requests.userId, userId),
  orderBy: [desc(requests.createdAt)],
  with: {
    // Add images relation
    images: {
      columns: {
        id: true,
        requestId: true,
        url: true,
        publicId: true,
        createdAt: true
      }
    },
    service: {
      columns: {
        id: true,
        name: true,
        category: true,
        description: true,
        createdAt: true
      }
    },
    college: {
      columns: {
        id: true,
        name: true,
        location: true,
        createdAt: true
      }
    },
    bids: {
      columns: {
        id: true,
        userId: true,
        requestId: true,
        providerId: true,
        price: true,
        message: true,
        status: true,
        isGraduateOfRequestedCollege: true,
        createdAt: true
      }
    },
    ...(includeParam.includes('interests') && {
      interests: {
        columns: {
          id: true,
          requestId: true,
          providerId: true,
          message: true,
          status: true,
          isShortlisted: true,
          chatRoomId: true,
          createdAt: true
        },
        with: {
          provider: {
            columns: {
              id: true,
              userId: true,
              firstName: true,
              lastName: true,
              phoneNumber: true,
              collegeId: true,
              latitude: true,
              longitude: true,
              address: true,
              bio: true,
              isProfileComplete: true,
              rating: true,
              completedRequests: true,
              profileImageUrl: true,
              createdAt: true,
              updatedAt: true
            },
            with: {
              user: {
                columns: {
                  id: true,
                  full_name: true,
                  email: true,
                  contact_phone: true,
                  address: true,
                  avatar: true,
                  role: true,
                  created_at: true,
                  updated_at: true
                }
              }
            }
          }
        }
      }
    })
  }
};

    const rawRequests = await db.query.requests.findMany(queryOptions) as QueryResult[];

    // Type the response with proper typing
    const formatted: TSRequestsWithRelations[] = rawRequests.map((r) => {
  const extendedRequest: TSRequestsWithRelations = {
    // Base request properties
    id: r.id,
    userId: r.userId,
    description: r.description,
    createdAt: r.createdAt,
    serviceId: r.serviceId,
    productName: r.productName,
    isService: r.isService,
    desiredPrice: r.desiredPrice,
    location: r.location,
    collegeFilterId: r.collegeFilterId,
    status: r.status as "open" | "closed" | "pending" | null,
    allowInterests: r.allowInterests,
    allowBids: r.allowBids,
    accepted_bid_id: r.accepted_bid_id,
     expiresAt: r.expiresAt,  // Add new field
        archivedAt: r.archivedAt,  // Add new field
        archivedByClient: r.archivedByClient,  // Add new field
    // Add computed fields
    budget: r.desiredPrice,
    title: r.productName || (r.service?.name ?? '') || '',
    category: r.service?.category || '',
    serviceName: r.service?.name || '',
    created_at: r.createdAt,
    
// Add images with proper URL normalization and null filtering
images: (r.images || [])
  .map(img => normalizeUrl(img.url))
  .filter((url): url is string => url !== null),
    
    // Add relations
    service: r.service || null,
    college: r.college || null,
    bids: (r.bids || []).map(bid => ({
      ...bid,
      status: bid.status as "pending" | "accepted" | "rejected" | null
    })),
    interests: (r.interests || []).map(i => ({
      id: i.id,
      requestId: i.requestId,
      providerId: i.providerId,
      message: i.message,
      status: i.status,
      chatRoomId: i.chatRoomId ?? null,
      isShortlisted: i.isShortlisted,
      createdAt: i.createdAt,
      provider: i.provider ? {
        id: i.provider.id,
        userId: i.provider.userId,
        firstName: i.provider.firstName,
        lastName: i.provider.lastName,
        phoneNumber: i.provider.phoneNumber,
        collegeId: i.provider.collegeId,
        latitude: i.provider.latitude,
        longitude: i.provider.longitude,
        address: i.provider.address,
        bio: i.provider.bio,
        isProfileComplete: i.provider.isProfileComplete,
        rating: i.provider.rating,
        completedRequests: i.provider.completedRequests,
        profileImageUrl: normalizeUrl(i.provider.profileImageUrl),
        createdAt: i.provider.createdAt,
        updatedAt: i.provider.updatedAt,
        status: 'some-default-status',
        user: i.provider.user ? {
          id: i.provider.user.id,
          full_name: i.provider.user.full_name,
          email: i.provider.user.email,
          contact_phone: i.provider.user.contact_phone,
          address: i.provider.user.address,
          avatar: normalizeUrl(i.provider.user.avatar),
          role: ['admin', 'service_provider', 'client'].includes(i.provider.user.role)
            ? i.provider.user.role as "admin" | "service_provider" | "client"
            : 'client',
          created_at: i.provider.user.created_at,
          updated_at: i.provider.user.updated_at
        } : null
      } : null
    }))
  };

  return extendedRequest;
});

    return c.json(formatted);
  } catch (error) {
    console.error('Error fetching requests:', error);
    return c.json({ error: 'Failed to fetch requests' }, 500);
  }
});

// POST /bids - client sends a bid to a provider
app.post('/', async (c) => {
  const clientId = Number(c.get('user').id);
  const { providerId, requestId, price, message } = await c.req.json();

  // Validate required fields
  if (!providerId || !requestId || price === undefined) {
    return c.json({ error: 'Missing required fields' }, 400);
  }

  try {
    // Verify the request exists and belongs to the client
    const request = await db.query.requests.findFirst({
      where: and(
        eq(requests.id, requestId),
        eq(requests.userId, clientId)
      ),
    });

    if (!request) {
      return c.json({ error: 'Request not found or unauthorized' }, 404);
    }

    // Create the bid
    const [newBid] = await db.insert(bids).values({
      providerId: Number(providerId),
      requestId: Number(requestId),
      price: Number(price),
      message: message || null,
      status: 'pending',
      isGraduateOfRequestedCollege: false, // Default value
      createdAt: new Date()
    }).returning();

    // Send notification to provider
    await db.insert(notifications).values({
      userId: providerId,
      type: 'new_bid',
      message: `You have a new bid for request #${requestId}`,
      isRead: false,
      relatedEntityId: newBid.id,
      createdAt: new Date()
    });

    return c.json(newBid, 201);
  } catch (error) {
    console.error('Error creating bid:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// Get detailed bids for a specific request
app.get('/requests/:id/bids', async (c) => {
  const userId = Number(c.get('user').id); // ✅ Convert string to number
  const requestId = parseInt(c.req.param('id'), 10); // ✅ Make sure it's a number

  if (isNaN(userId) || isNaN(requestId)) {
    return c.json({ error: 'Invalid user or request ID' }, 400);
  }

  // ✅ Verify request ownership
  const request = await db.query.requests.findFirst({
    where: and(
      eq(requests.id, requestId),
      eq(requests.userId, userId) // ✅ Now both sides are numbers
    )
  });

  if (!request) {
    return c.json({ error: 'Request not found or unauthorized' }, 404);
  }

  const requestBids = await db.query.bids.findMany({
    where: eq(bids.requestId, requestId),
    with: {
      provider: {
        with: {
          user: true,
        },
      },
    },
    orderBy: (bids, { asc }) => [asc(bids.createdAt)],
  });

  return c.json(requestBids);
});


// Accept a bid with enhanced validation
app.post('/bids/:id/accept', async (c) => {
  try {
    const userId = Number(c.get('user')?.id);
    const bidId = parseInt(c.req.param('id'), 10);
    
    if (isNaN(userId) || isNaN(bidId)) {
      return c.json({ error: 'Invalid user or bid ID' }, 400);
    }

    // 1. First verify the bid and request
    const bidWithRequest = await db.query.bids.findFirst({
      where: eq(bids.id, bidId),
      with: { request: true },
    });

    if (!bidWithRequest || !bidWithRequest.request) {
      return c.json({ error: 'Bid not found or unauthorized' }, 404);
    }

    if (bidWithRequest.request.userId !== userId) {  // Note: user_id instead of userId
      return c.json({ error: 'Unauthorized' }, 403);
    }

    if (bidWithRequest.request.status !== 'open') {
      return c.json({ error: 'Request is no longer open' }, 400);
    }

    // 2. Execute updates sequentially
    await db.update(bids)
      .set({ status: 'accepted' })
      .where(eq(bids.id, bidId));

    await db.update(requests)
      .set({ 
        status: 'closed',
        accepted_bid_id: bidId  // Changed to snake_case
      })
      .where(eq(requests.id, bidWithRequest.request.id));

    await db.update(bids)
      .set({ status: 'rejected' })
      .where(
        and(
          eq(bids.requestId, bidWithRequest.request.id),  // Note: request_id instead of requestId
          eq(bids.status, 'pending')
        )
      );

    // 3. Create notifications - ensure all required fields are included
    if (!bidWithRequest.providerId) {  // Note: provider_id instead of providerId
      throw new Error('Provider ID is missing');
    }

    const notificationData = [
      {
        userId: bidWithRequest.providerId,  // Note: user_id instead of userId
        type: 'bid_accepted',
        message: `Your bid for request #${bidWithRequest.request.id} was accepted!`,
        related_entity_id: bidId,  // Note: related_entity_id instead of relatedEntityId
        isRead: false,  // Assuming this is required
        createdAt: new Date()  // Assuming this is required
      },
      {
        userId: userId,
        type: 'bid_accepted_confirmation',
        message: `You accepted a bid from provider #${bidWithRequest.providerId}`,
        relatedEntityId: bidWithRequest.request.id,
        isRead: false,
        createdAt: new Date()
      },
    ];
    
    await db.insert(notifications).values(notificationData);

    return c.json({ success: true });
    
  } catch (error) {
    console.error('Error accepting bid:', error);
    return c.json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

// Notification endpoints
app.get('/notifications', async (c) => {
  const userId = Number(c.get('user').id);

  const userNotifications = await db.query.notifications.findMany({
    where: eq(notifications.userId, userId),
    orderBy: (n, { desc }) => [desc(n.createdAt)],
    limit: 50
  });

  return c.json(userNotifications);
});


app.patch('/notifications/:id/read', async (c) => {
  const userId = Number(c.get('user').id);
  const notificationId = parseInt(c.req.param('id'));

  await db.update(notifications)
    .set({ isRead: true })
    .where(
      and(
        eq(notifications.id, notificationId),
        eq(notifications.userId, userId)
      )
    );

  return c.json({ success: true });
});



app.post('/requests', async (c) => {
  const userId = Number(c.get('user').id);
  
  let body: any;
  let imageFiles: File[] = [];
  const contentType = c.req.header('content-type') || '';
  
  try {
    // Check if it's multipart/form-data or JSON
    if (contentType.toLowerCase().includes('multipart/form-data')) {
      // Handle FormData with images
      const formData = await c.req.formData();
      
      // Extract form fields
      body = {
        productName: formData.get('productName')?.toString() || null,
        description: formData.get('description')?.toString() || null,
        desiredPrice: formData.get('desiredPrice')?.toString() || null,
        isService: formData.get('isService')?.toString() === 'true',
        serviceId: formData.get('serviceId')?.toString() || null,
        location: formData.get('location')?.toString() || null,
        collegeFilterId: formData.get('collegeFilterId')?.toString() || null
      };
      
      // Extract images
      const rawImageFiles = formData.getAll('images');
      imageFiles = rawImageFiles.filter((file): file is File => 
        file instanceof File && 
        file.size > 0 && 
        file.size <= 5 * 1024 * 1024 && 
        file.type.startsWith('image/')
      );
      
    } else {
      // Handle JSON
      body = await c.req.json();
    }
  } catch (error) {
    console.error('Error parsing request body:', error);
    return c.json({ 
      error: 'Invalid request format',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 400);
  }

  // Validation
  if (body.isService && !body.serviceId) {
    return c.json({ error: 'Service ID is required' }, 400);
  }

  if (!body.isService && !body.productName) {
    return c.json({ error: 'Product name is required' }, 400);
  }

  if (!body.desiredPrice || isNaN(Number(body.desiredPrice)) || Number(body.desiredPrice) < 0) {
    return c.json({ error: 'Valid desired price is required' }, 400);
  }

  if (!body.location || typeof body.location !== 'string' || body.location.trim() === '') {
    return c.json({ error: 'Location is required' }, 400);
  }

  let requestId: number | null = null;
  
  try {
    // Set automatic expiration - 7 days from now
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
    
    // Create the request in database
    const [request] = await db.insert(requests).values({
      userId,
      serviceId: body.isService ? Number(body.serviceId) : null,
      productName: !body.isService ? body.productName : null,
      isService: Boolean(body.isService),
      description: body.description,
      desiredPrice: Number(body.desiredPrice),
      location: body.location,
      collegeFilterId: body.collegeFilterId ? Number(body.collegeFilterId) : null,
      status: 'open',
      expiresAt: expiresAt, // Set automatic expiration
    }).returning();

    if (!request || !request.id) {
      throw new Error('Database insert failed');
    }

    requestId = request.id;

    // Handle image uploads to Cloudinary
    if (imageFiles.length > 0) {
      const uploadResults = await Promise.allSettled(
        imageFiles.map(async (file) => {
          try {
            const folderPath = `users/${userId}/requests/${requestId}`;
            const result = await uploadToCloudinary(file, folderPath, c);
            
            if (!result || !result.url) {
              throw new Error('Upload failed - no URL returned');
            }
            
            return result;
          } catch (uploadError) {
            console.error('Image upload failed:', uploadError);
            throw new Error(`Upload failed for ${file.name}: ${uploadError instanceof Error ? uploadError.message : 'Unknown error'}`);
          }
        })
      );

      // Save successful uploads to database
      const successfulUploads = uploadResults
        .filter((result): result is PromiseFulfilledResult<any> => result.status === 'fulfilled')
        .map(result => result.value);

      if (successfulUploads.length > 0) {
        const imageRecords = successfulUploads.map(result => ({
          requestId: requestId!,
          url: result.url,
          publicId: result.public_id
        }));

        await db.insert(requestImages).values(imageRecords);
      }
    }

    // Fetch the complete request with images
    const completeRequest = await db.query.requests.findFirst({
      where: eq(requests.id, requestId),
      with: {
        images: {
          columns: {
            url: true
          }
        },
        service: {
          columns: {
            name: true,
            category: true
          }
        }
      }
    });

    // Construct response with proper image URLs
    const baseURL = process.env.API_BASE_URL || 'https://mkt-backend-sz2s.onrender.com';
    const response = {
      ...completeRequest,
      images: (completeRequest?.images || []).map((img: any) => {
        // Ensure absolute URLs
        if (img.url && !img.url.startsWith('http')) {
          return `${baseURL}${img.url.startsWith('/') ? '' : '/'}${img.url}`;
        }
        return img.url;
      }).filter(Boolean)
    };

    return c.json(response);

  } catch (error) {
    console.error('Error creating request:', error);
    
    // Cleanup on error
    if (requestId) {
      try {
        // Delete any uploaded images from Cloudinary
        const imagesToDelete = await db.query.requestImages.findMany({
          where: eq(requestImages.requestId, requestId),
          columns: { publicId: true }
        });
        
        await Promise.allSettled([
          db.delete(requests).where(eq(requests.id, requestId)),
          ...imagesToDelete.map(img => 
            img.publicId ? deleteFromCloudinary(img.publicId, c) : Promise.resolve()
          )
        ]);
      } catch (cleanupError) {
        console.error('Cleanup failed:', cleanupError);
      }
    }
    
    return c.json({ 
      error: 'Internal server error',
      message: 'Failed to create request',
      timestamp: new Date().toISOString()
    }, 500);
  }
});

// Add expiration and archiving endpoints
app.patch('/requests/:id/archive', async (c) => {
  const userId = Number(c.get('user').id);
  const requestId = parseInt(c.req.param('id'), 10);

  if (isNaN(userId) || isNaN(requestId)) {
    return c.json({ error: 'Invalid user or request ID' }, 400);
  }

  try {
    // Verify request ownership
    const request = await db.query.requests.findFirst({
      where: and(
        eq(requests.id, requestId),
        eq(requests.userId, userId)
      )
    });

    if (!request) {
      return c.json({ error: 'Request not found or unauthorized' }, 404);
    }

    // Archive the request
    const [updatedRequest] = await db.update(requests)
      .set({ 
        archivedAt: new Date(),
        archivedByClient: true,
        status: 'archived' // Add this status if you want it
      })
      .where(eq(requests.id, requestId))
      .returning();

    return c.json({ 
      success: true, 
      message: 'Request archived successfully',
      request: updatedRequest 
    });

  } catch (error) {
    console.error('Error archiving request:', error);
    return c.json({ error: 'Failed to archive request' }, 500);
  }
});

app.patch('/requests/:id/unarchive', async (c) => {
  const userId = Number(c.get('user').id);
  const requestId = parseInt(c.req.param('id'), 10);

  if (isNaN(userId) || isNaN(requestId)) {
    return c.json({ error: 'Invalid user or request ID' }, 400);
  }

  try {
    // Verify request ownership
    const request = await db.query.requests.findFirst({
      where: and(
        eq(requests.id, requestId),
        eq(requests.userId, userId)
      )
    });

    if (!request) {
      return c.json({ error: 'Request not found or unauthorized' }, 404);
    }

    // Unarchive the request
    const [updatedRequest] = await db.update(requests)
      .set({ 
        archivedAt: null,
        archivedByClient: false,
        status: 'open' // Or whatever status it should return to
      })
      .where(eq(requests.id, requestId))
      .returning();

    return c.json({ 
      success: true, 
      message: 'Request unarchived successfully',
      request: updatedRequest 
    });

  } catch (error) {
    console.error('Error unarchiving request:', error);
    return c.json({ error: 'Failed to unarchive request' }, 500);
  }
});

app.delete('/requests/:id', async (c) => {
  const userId = Number(c.get('user').id);
  const requestId = parseInt(c.req.param('id'), 10);

  if (isNaN(userId) || isNaN(requestId)) {
    return c.json({ error: 'Invalid user or request ID' }, 400);
  }

  try {
    // Verify request ownership
    const request = await db.query.requests.findFirst({
      where: and(
        eq(requests.id, requestId),
        eq(requests.userId, userId)
      )
    });

    if (!request) {
      return c.json({ error: 'Request not found or unauthorized' }, 404);
    }

    // Check if request can be deleted (only if no accepted bids/interests)
    if (request.accepted_bid_id || request.status === 'closed') {
      return c.json({ 
        error: 'Cannot delete request with accepted bids or completed status' 
      }, 400);
    }

    // Soft delete by archiving
    const [updatedRequest] = await db.update(requests)
      .set({ 
        archivedAt: new Date(),
        archivedByClient: true,
        status: 'deleted'
      })
      .where(eq(requests.id, requestId))
      .returning();

    return c.json({ 
      success: true, 
      message: 'Request deleted successfully',
      request: updatedRequest 
    });

  } catch (error) {
    console.error('Error deleting request:', error);
    return c.json({ error: 'Failed to delete request' }, 500);
  }
});

export default app;