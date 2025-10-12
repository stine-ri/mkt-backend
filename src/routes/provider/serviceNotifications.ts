import { Hono } from 'hono';
import { db } from '../../drizzle/db.js';
import { 
  providers, 
  services, 
  providerServices, 
  users, 
  serviceRequests,
  notifications 
} from '../../drizzle/schema.js';
import type { TIServiceRequests } from '../../drizzle/schema.js';
import { eq } from 'drizzle-orm';
import { whatsappService } from '../../services/whatsappServices.js';

const enhancedServiceNotifications = new Hono();

// Enhanced batch notification with WhatsApp URL generation
enhancedServiceNotifications.post('/services/notify/batch-enhanced', async (c) => {
  try {
    const body = await c.req.json();
    const {
      serviceId,
      serviceName,
      clientInfo,
      requestDetails
    } = body;

    // Parse and validate inputs
    const parsedServiceId = parseInt(serviceId);
    const clientUserId = parseInt(clientInfo.userId);
    
    if (isNaN(parsedServiceId) || isNaN(clientUserId)) {
      return c.json({ 
        success: false, 
        error: 'Invalid service ID or client user ID' 
      }, 400);
    }

    // Get all providers for this service
    const serviceProviders = await db
      .select({
        id: providers.id,
        firstName: providers.firstName,
        lastName: providers.lastName,
        phoneNumber: providers.phoneNumber,
        profileImageUrl: providers.profileImageUrl
      })
      .from(providerServices)
      .innerJoin(providers, eq(providerServices.providerId, providers.id))
      .where(eq(providerServices.serviceId, parsedServiceId));

    if (serviceProviders.length === 0) {
      return c.json({ 
        success: false, 
        error: 'No providers found for this service' 
      }, 404);
    }

    // Log received data for debugging
    console.log('Received client info:', clientInfo);
    console.log('Received request details:', requestDetails);

    // Generate WhatsApp message with properly mapped fields
    const whatsappMessage = whatsappService.generateServiceRequestMessage(
      serviceName, 
      { 
        ...requestDetails, 
        clientName: clientInfo.name,
        clientPhone: clientInfo.phone
      }
    );

    console.log('Generated WhatsApp message:', whatsappMessage);

    // Generate WhatsApp URLs for all providers
    const whatsappUrls = whatsappService.generateBatchWhatsAppUrls(
      serviceProviders, 
      whatsappMessage
    );

    // Create notifications in database
    const notificationPromises = serviceProviders.map(async (provider) => {
      const [notification] = await db.insert(notifications).values({
        userId: provider.id,
        type: 'service_request',
        message: `New ${serviceName} request from ${clientInfo.name || 'a client'}`,
        relatedEntityId: parsedServiceId,
        isRead: false,
        createdAt: new Date()
      }).returning();

      return {
        providerId: provider.id,
        providerName: `${provider.firstName} ${provider.lastName}`,
        phoneNumber: provider.phoneNumber,
        notificationId: notification.id,
        whatsappUrl: whatsappService.generateWhatsAppUrl(provider.phoneNumber, whatsappMessage),
        timestamp: new Date().toISOString()
      };
    });

    const notificationResults = await Promise.all(notificationPromises);

    // Get first provider ID for the service request
    const firstProviderId = serviceProviders[0].id;

    // Prepare the service request data with explicit typing
    const serviceRequestData: TIServiceRequests = {
      clientId: clientUserId,
      providerId: firstProviderId,
      serviceId: parsedServiceId,
      requestTitle: `Service Request: ${serviceName}`,
      description: requestDetails.description || null,
      budgetMin: requestDetails.budget ? String(parseFloat(requestDetails.budget)) : null,
      budgetMax: requestDetails.budget ? String(parseFloat(requestDetails.budget)) : null,
      deadline: requestDetails.preferredDate ? new Date(requestDetails.preferredDate) : null,
      status: 'pending',
      urgency: 'normal',
      location: requestDetails.location || null,
      clientNotes: `Contact method: ${requestDetails.contactMethod}. Client: ${clientInfo.name}. Phone: ${clientInfo.phone}`,
      providerResponse: null,
      chatRoomId: null,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Create service request record
    const [serviceRequest] = await db
      .insert(serviceRequests)
      .values(serviceRequestData)
      .returning();

    console.log('✅ Enhanced batch notification completed:', {
      serviceId: parsedServiceId,
      serviceName,
      totalProviders: serviceProviders.length,
      serviceRequestId: serviceRequest.id
    });

    return c.json({
      success: true,
      message: `Service request created and ${serviceProviders.length} providers notified`,
      serviceRequestId: serviceRequest.id,
      notifications: notificationResults,
      whatsappMessage: whatsappMessage,
      totalProviders: serviceProviders.length
    });

  } catch (error) {
    console.error('Error in enhanced batch notification:', error);
    return c.json({ 
      success: false, 
      error: 'Failed to process service request',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

// Get WhatsApp URLs for manual notification (frontend can open these)
enhancedServiceNotifications.post('/services/whatsapp-urls', async (c) => {
  try {
    const body = await c.req.json();
    const { serviceId, clientInfo, requestDetails } = body;

    const parsedServiceId = parseInt(serviceId);
    
    if (isNaN(parsedServiceId)) {
      return c.json({ 
        success: false, 
        error: 'Invalid service ID' 
      }, 400);
    }

    // Get providers
    const serviceProviders = await db
      .select({
        id: providers.id,
        firstName: providers.firstName,
        lastName: providers.lastName,
        phoneNumber: providers.phoneNumber
      })
      .from(providerServices)
      .innerJoin(providers, eq(providerServices.providerId, providers.id))
      .where(eq(providerServices.serviceId, parsedServiceId));

    // Generate WhatsApp message
    const service = await db
      .select()
      .from(services)
      .where(eq(services.id, parsedServiceId))
      .limit(1);

    const serviceName = service[0]?.name || 'Service';

    const whatsappMessage = whatsappService.generateServiceRequestMessage(
      serviceName, 
      { 
        ...requestDetails, 
        clientName: clientInfo.name,
        clientPhone: clientInfo.phone
      }
    );

    // Generate URLs
    const urls = whatsappService.generateBatchWhatsAppUrls(serviceProviders, whatsappMessage);

    return c.json({
      success: true,
      serviceName,
      message: whatsappMessage,
      urls: urls.filter(url => url.isValid),
      totalProviders: serviceProviders.length,
      validProviders: urls.filter(url => url.isValid).length
    });

  } catch (error) {
    console.error('Error generating WhatsApp URLs:', error);
    return c.json({ 
      success: false, 
      error: 'Failed to generate WhatsApp URLs' 
    }, 500);
  }
});

export default enhancedServiceNotifications;