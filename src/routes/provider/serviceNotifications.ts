// routes/services/sms-notifications.ts
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
import { notificationService } from '../../services/notificationService.js';
import { sendBulkSMSNotifications } from '../../services/smsNotification.js';

const smsServiceNotifications = new Hono();

// Enhanced batch notification with SMS
smsServiceNotifications.post('/services/notify/batch-sms', async (c) => {
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

    // Generate SMS message
    const smsMessage = notificationService.generateServiceRequestMessage(
      serviceName, 
      { 
        ...requestDetails, 
        clientName: clientInfo.name,
        clientPhone: clientInfo.phone
      }
    );

    console.log('Generated SMS message:', smsMessage);

    // Send SMS notifications to all providers
    const smsResults = await sendBulkSMSNotifications(serviceProviders, smsMessage);

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
        timestamp: new Date().toISOString()
      };
    });

    const notificationResults = await Promise.all(notificationPromises);

    // Create service request records for EACH provider
    const serviceRequestPromises = serviceProviders.map(async (provider) => {
      const serviceRequestData: TIServiceRequests = {
        clientId: clientUserId,
        providerId: provider.id,
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

      const [serviceRequest] = await db
        .insert(serviceRequests)
        .values(serviceRequestData)
        .returning();

      return {
        providerId: provider.id,
        providerName: `${provider.firstName} ${provider.lastName}`,
        serviceRequestId: serviceRequest.id
      };
    });

    const serviceRequestResults = await Promise.all(serviceRequestPromises);

    const successfulSMS = smsResults.filter(r => r.success).length;
    
    console.log('✅ SMS batch notification completed:', {
      serviceId: parsedServiceId,
      serviceName,
      totalProviders: serviceProviders.length,
      successfulSMS: successfulSMS,
      serviceRequestsCreated: serviceRequestResults.length
    });

    const firstServiceRequestId = serviceRequestResults[0]?.serviceRequestId;
    
    return c.json({
      success: true,
      message: `Service request created and SMS sent to ${successfulSMS}/${serviceProviders.length} providers`,
      serviceRequestId: firstServiceRequestId,
      notifications: notificationResults,
      smsResults: smsResults,
      totalProviders: serviceProviders.length,
      successfulSMS: successfulSMS,
      smsMessage: smsMessage
    });

  } catch (error) {
    console.error('Error in SMS batch notification:', error);
    return c.json({ 
      success: false, 
      error: 'Failed to process service request',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

// Get SMS notification status
smsServiceNotifications.post('/services/sms-status', async (c) => {
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

    // Generate SMS message
    const service = await db
      .select()
      .from(services)
      .where(eq(services.id, parsedServiceId))
      .limit(1);

    const serviceName = service[0]?.name || 'Service';

    const smsMessage = notificationService.generateServiceRequestMessage(
      serviceName, 
      { 
        ...requestDetails, 
        clientName: clientInfo.name,
        clientPhone: clientInfo.phone
      }
    );

    const notificationData = notificationService.generateBatchNotificationsData(serviceProviders, smsMessage);

    return c.json({
      success: true,
      serviceName,
      message: smsMessage,
      providers: notificationData,
      totalProviders: serviceProviders.length,
      validProviders: notificationData.filter(item => item.isValid).length
    });

  } catch (error) {
    console.error('Error generating SMS status:', error);
    return c.json({ 
      success: false, 
      error: 'Failed to generate SMS status' 
    }, 500);
  }
});

export default smsServiceNotifications;