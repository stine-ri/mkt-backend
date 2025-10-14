// services/notificationService.ts - UPDATED VERSION
export class NotificationService {
  // Generate professional SMS message for service request with clickable phone
  generateServiceRequestMessage(serviceName: string, clientRequest: any): string {
    const {
      description,
      location,
      budget,
      preferredDate,
      clientName,
      clientPhone
    } = clientRequest;

    return `🛎️ NEW SERVICE REQUEST - Quisells\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `📋 *Service:* ${serviceName}\n` +
      `━━━━━━━━━━━━━━━━━━━━\n\n` +
      `👤 *Client Details:*\n` +
      `   • Name: ${clientName}\n` +
      `   • Phone: ${clientPhone} 📞\n` +
      `   • Location: ${location}\n\n` +
      `💰 *Budget:* ${budget ? `KES ${budget}` : 'Negotiable'}\n` +
      `📅 *Preferred Date:* ${preferredDate || 'Flexible'}\n` +
      `📝 *Description:*\n${description}\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `⚡ *ACTION REQUIRED:*\n` +
      `This request has been sent to multiple providers.\n` +
      `*Respond quickly to secure this client!*\n\n` +
      `📞 *Call Client:* ${clientPhone}\n` +
      `💬 *Message Client:* ${clientPhone}\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🌐 Visit: *quisells.com*\n` +
      `📧 Support: *ombongidiaz@gmail.com*\n\n` +
      `Powered by Quisells Marketplace 🚀`;
  }

  // Validate phone number
  validatePhoneNumber(phoneNumber: string): { isValid: boolean; cleanNumber: string } {
    const cleanNumber = phoneNumber.replace(/\D/g, '');
    const isValid = cleanNumber.length >= 9 && cleanNumber.length <= 15;
    
    return {
      isValid,
      cleanNumber: isValid ? cleanNumber : ''
    };
  }

  // Generate batch notifications data
  generateBatchNotificationsData(
    providers: Array<{ phoneNumber: string; firstName?: string; lastName?: string }>, 
    message: string
  ): Array<{ 
    phoneNumber: string; 
    isValid: boolean;
    providerName?: string;
  }> {
    return providers.map(provider => {
      const validation = this.validatePhoneNumber(provider.phoneNumber);
      return {
        phoneNumber: provider.phoneNumber,
        isValid: validation.isValid,
        providerName: provider.firstName && provider.lastName 
          ? `${provider.firstName} ${provider.lastName}` 
          : undefined
      };
    });
  }
}

export const notificationService = new NotificationService();