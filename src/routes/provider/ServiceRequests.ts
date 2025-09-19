// services/serviceRequests.js - Status filtering fix
import { Hono } from 'hono';
import { db } from '../../drizzle/db.js';
import { 
  serviceRequests, 
  chatRooms, 
  messages, 
  users, 
  providers, 
  services,
  notifications,
  providerServices 
} from '../../drizzle/schema.js';
import { eq, and, desc, or } from 'drizzle-orm';
import type { CustomContext } from '../../types/context.js';
import { authMiddleware } from '../../middleware/bearAuth.js';

const app = new Hono<CustomContext>();

// Apply auth middleware to all routes
app.use('*', authMiddleware);

// CREATE: Send a new service request - ALLOW ALL AUTHENTICATED USERS
app.post('/', async (c) => {
  try {
    const user = c.get('user');
    const userId = Number(user.id);
    
    // Allow all authenticated users to make service requests
    if (!user || !user.id) {
      return c.json({ error: 'Authentication required' }, 401);
    }

    const {
      providerId,
      serviceId,
      requestTitle,
      description,
      budgetMin,
      budgetMax,
      deadline,
      urgency,
      location,
      clientNotes
    } = await c.req.json();

    // Validate required fields
    if (!providerId || !serviceId || !requestTitle) {
      return c.json({ 
        success: false,
        error: 'Provider, service, and title are required' 
      }, 400);
    }

    // Verify the provider exists and offers this service
    const providerService = await db.query.providerServices.findFirst({
      where: and(
        eq(providerServices.providerId, providerId),
        eq(providerServices.serviceId, serviceId)
      ),
      with: {
        provider: {
          with: {
            user: {
              columns: { id: true, full_name: true }
            }
          }
        },
        service: {
          columns: { id: true, name: true }
        }
      }
    });

    if (!providerService) {
      return c.json({ 
        success: false,
        error: 'Provider does not offer this service' 
      }, 400);
    }

    // Prevent users from requesting their own services
    if (providerService.provider.user.id === userId) {
      return c.json({ 
        success: false,
        error: 'Cannot request your own service' 
      }, 400);
    }

    // Create the service request
    const [request] = await db.insert(serviceRequests).values({
      clientId: userId,
      providerId,
      serviceId,
      requestTitle,
      description: description || null,
      budgetMin: budgetMin ? budgetMin.toString() : null,
      budgetMax: budgetMax ? budgetMax.toString() : null,
      deadline: deadline ? new Date(deadline) : null,
      urgency: urgency || 'normal',
      location: location || null,
      clientNotes: clientNotes || null,
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date()
    }).returning();

    // Get client info for notification
    const client = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { full_name: true, email: true }
    });

    // Create notification for provider
    await db.insert(notifications).values({
      userId: providerService.provider.user.id,
      type: 'new_service_request',
      message: `New service request from ${client?.full_name || 'Unknown'}: ${requestTitle}`,
      relatedEntityId: request.id,
      isRead: false,
      createdAt: new Date()
    });

    return c.json({
      success: true,
      data: request
    }, 201);

  } catch (error) {
    console.error('Error creating service request:', error);
    return c.json({ 
      success: false,
      error: 'Failed to create service request',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

// READ: Get service requests for current user - HANDLE ALL ROLES
app.get('/', async (c) => {
  try {
    const user = c.get('user');
    const userId = Number(user.id);
    const { status, view } = c.req.query();

    let whereCondition;
    
    // Handle different roles and views
    if (view === 'outgoing' || user.role === 'client') {
      // Show requests made by this user (outgoing)
      whereCondition = eq(serviceRequests.clientId, userId);
    } else if (view === 'incoming' || user.role === 'service_provider') {
      // Show requests received by this provider (incoming)
      const provider = await db.query.providers.findFirst({
        where: eq(providers.userId, userId),
        columns: { id: true }
      });
      
      if (!provider) {
        return c.json({ 
          success: false,
          error: 'Provider profile not found' 
        }, 404);
      }
      
      whereCondition = eq(serviceRequests.providerId, provider.id);
    } else {
      // For other roles (admin, product_seller), show all requests they're involved in
      whereCondition = or(
        eq(serviceRequests.clientId, userId)
        // Add additional conditions for other roles if needed
      );
    }

    // Add status filter if provided and valid - FIX THE TYPE ISSUE HERE
    if (status) {
      const validStatuses = ['pending', 'accepted', 'declined', 'completed'] as const;
      type ValidStatus = typeof validStatuses[number];
      
      if (validStatuses.includes(status as ValidStatus)) {
        whereCondition = and(whereCondition, eq(serviceRequests.status, status as ValidStatus));
      } else {
        return c.json({ 
          success: false,
          error: 'Invalid status value. Must be one of: pending, accepted, declined, completed' 
        }, 400);
      }
    }

    const requests = await db.query.serviceRequests.findMany({
      where: whereCondition,
      with: {
        client: {
          columns: {
            id: true,
            full_name: true,
            email: true,
            avatar: true
          }
        },
        provider: {
          columns: {
            id: true,
            firstName: true,
            lastName: true,
            profileImageUrl: true
          }
        },
        service: {
          columns: {
            id: true,
            name: true,
            description: true
          }
        },
        chatRoom: {
          columns: {
            id: true,
            status: true
          }
        }
      },
      orderBy: [desc(serviceRequests.createdAt)]
    });

    return c.json({
      success: true,
      data: requests
    });

  } catch (error) {
    console.error('Error fetching service requests:', error);
    return c.json({ 
      success: false,
      error: 'Failed to fetch service requests',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

// READ: Get specific service request - ALLOW ALL INVOLVED PARTIES
app.get('/:id', async (c) => {
  try {
    const requestId = Number(c.req.param('id'));
    const user = c.get('user');
    const userId = Number(user.id);

    const request = await db.query.serviceRequests.findFirst({
      where: eq(serviceRequests.id, requestId),
      with: {
        client: {
          columns: {
            id: true,
            full_name: true,
            email: true,
            avatar: true
          }
        },
        provider: {
          columns: {
            id: true,
            firstName: true,
            lastName: true,
            profileImageUrl: true
          },
          with: {
            user: {
              columns: {
                id: true
              }
            }
          }
        },
        service: true,
        chatRoom: true
      }
    });

    if (!request) {
      return c.json({ 
        success: false,
        error: 'Service request not found' 
      }, 404);
    }

    // Check authorization - allow client, provider, and admin
    const isClient = request.clientId === userId;
    const isProvider = request.provider?.user?.id === userId;
    const isAdmin = user.role === 'admin';

    if (!isClient && !isProvider && !isAdmin) {
      return c.json({ 
        success: false,
        error: 'Unauthorized access' 
      }, 403);
    }

    return c.json({
      success: true,
      data: request
    });

  } catch (error) {
    console.error('Error fetching service request:', error);
    return c.json({ 
      success: false,
      error: 'Failed to fetch service request',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

// UPDATE: Provider responds to service request (accept/decline) - ONLY SERVICE PROVIDERS
app.post('/:id/respond', async (c) => {
  try {
    const requestId = Number(c.req.param('id'));
    const user = c.get('user');
    const userId = Number(user.id);
    const { action, response } = await c.req.json();

    // Only service providers can respond to requests
    if (user.role !== 'service_provider') {
      return c.json({ 
        success: false,
        error: 'Only service providers can respond to requests' 
      }, 403);
    }

    if (!action || !['accept', 'decline'].includes(action)) {
      return c.json({ 
        success: false,
        error: 'Action must be either "accept" or "decline"' 
      }, 400);
    }

    // Get provider profile
    const provider = await db.query.providers.findFirst({
      where: eq(providers.userId, userId),
      columns: { id: true }
    });

    if (!provider) {
      return c.json({ 
        success: false,
        error: 'Provider profile not found' 
      }, 404);
    }

    // Get the service request
    const request = await db.query.serviceRequests.findFirst({
      where: and(
        eq(serviceRequests.id, requestId),
        eq(serviceRequests.providerId, provider.id)
      )
    });

    if (!request) {
      return c.json({ 
        success: false,
        error: 'Service request not found' 
      }, 404);
    }

    if (request.status !== 'pending') {
      return c.json({ 
        success: false,
        error: 'Request has already been responded to' 
      }, 400);
    }

    const newStatus = action === 'accept' ? 'accepted' : 'declined';

    // Update the request
    const [updatedRequest] = await db.update(serviceRequests)
      .set({
        status: newStatus,
        providerResponse: response || null,
        respondedAt: new Date(),
        updatedAt: new Date()
      })
      .where(eq(serviceRequests.id, requestId))
      .returning();

    // If accepted, create a chat room
    let chatRoom = null;
    if (action === 'accept') {
      [chatRoom] = await db.insert(chatRooms).values({
        clientId: request.clientId,
        providerId: userId,
        requestId: null,
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date()
      }).returning();

      // Update service request with chat room ID
      await db.update(serviceRequests)
        .set({ chatRoomId: chatRoom.id })
        .where(eq(serviceRequests.id, requestId));

      // Create welcome message
      await db.insert(messages).values({
        chatRoomId: chatRoom.id,
        senderId: userId,
        content: `Service request "${request.requestTitle}" has been accepted! Let's discuss the details.`,
        isSystem: true,
        read: false,
        createdAt: new Date()
      });
    }

    // Create notification for client
    await db.insert(notifications).values({
      userId: request.clientId,
      type: action === 'accept' ? 'service_request_accepted' : 'service_request_declined',
      message: `Your service request "${request.requestTitle}" has been ${action === 'accept' ? 'accepted' : 'declined'}${response ? ': ' + response : ''}`,
      relatedEntityId: updatedRequest.id,
      isRead: false,
      createdAt: new Date()
    });

    return c.json({
      success: true,
      data: {
        ...updatedRequest,
        chatRoom
      }
    });

  } catch (error) {
    console.error('Error responding to service request:', error);
    return c.json({ 
      success: false,
      error: 'Failed to respond to service request',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

// UPDATE: Mark service request as completed - ALLOW CLIENT AND PROVIDER
app.post('/:id/complete', async (c) => {
  try {
    const requestId = Number(c.req.param('id'));
    const user = c.get('user');
    const userId = Number(user.id);

    const request = await db.query.serviceRequests.findFirst({
      where: eq(serviceRequests.id, requestId),
      with: {
        provider: {
          with: {
            user: true
          }
        }
      }
    });

    if (!request) {
      return c.json({ 
        success: false,
        error: 'Service request not found' 
      }, 404);
    }

    // Either client or provider can mark as completed
    const isClient = request.clientId === userId;
    const isProvider = request.provider?.user?.id === userId;

    if (!isClient && !isProvider) {
      return c.json({ 
        success: false,
        error: 'Unauthorized' 
      }, 403);
    }

    if (request.status !== 'accepted') {
      return c.json({ 
        success: false,
        error: 'Can only complete accepted requests' 
      }, 400);
    }

    const [updatedRequest] = await db.update(serviceRequests)
      .set({
        status: 'completed',
        updatedAt: new Date()
      })
      .where(eq(serviceRequests.id, requestId))
      .returning();

    // Create notification for the other party
    const notifyUserId = isClient ? request.provider.user.id : request.clientId;
    await db.insert(notifications).values({
      userId: notifyUserId,
      type: 'service_request_completed',
      message: `Service request "${request.requestTitle}" has been marked as completed`,
      relatedEntityId: updatedRequest.id,
      isRead: false,
      createdAt: new Date()
    });

    return c.json({
      success: true,
      data: updatedRequest
    });

  } catch (error) {
    console.error('Error completing service request:', error);
    return c.json({ 
      success: false,
      error: 'Failed to complete service request',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

export default app;