// WhatsApp service utility for generating WhatsApp URLs
export class WhatsAppService {
  // Generate WhatsApp message for service request
  generateServiceRequestMessage(serviceName: string, clientRequest: any): string {
    const {
      description,
      location,
      budget,
      preferredDate,
      contactMethod,
      clientName,
      clientPhone
    } = clientRequest;

    return `🛎️ *NEW SERVICE REQUEST*\n\n` +
      `*Service:* ${serviceName}\n` +
      `*Client:* ${clientName}\n` +
      `*Phone:* ${clientPhone}\n` +
      `*Location:* ${location}\n` +
      `*Budget:* ${budget || 'Not specified'}\n` +
      `*Preferred Date:* ${preferredDate || 'Flexible'}\n` +
      `*Description:* ${description}\n\n` +
      `💡 *This request has been sent to multiple providers. Respond quickly to secure this client!*\n\n` +
      `Best regards,\nMarketplace Team`;
  }

  // Generate WhatsApp URL (for direct browser opening)
  generateWhatsAppUrl(phoneNumber: string, message: string): string {
    const cleanPhone = phoneNumber.replace(/\D/g, '');
    const encodedMessage = encodeURIComponent(message);
    return `https://wa.me/${cleanPhone}?text=${encodedMessage}`;
  }

  // Validate phone number for WhatsApp
  validatePhoneNumber(phoneNumber: string): { isValid: boolean; cleanNumber: string } {
    const cleanNumber = phoneNumber.replace(/\D/g, '');
    
    // Basic validation - you can enhance this based on your needs
    const isValid = cleanNumber.length >= 10 && cleanNumber.length <= 15;
    
    return {
      isValid,
      cleanNumber: isValid ? cleanNumber : ''
    };
  }

  // Generate multiple WhatsApp URLs for batch notifications
  generateBatchWhatsAppUrls(providers: Array<{ phoneNumber: string }>, message: string): Array<{ phoneNumber: string; url: string; isValid: boolean }> {
    return providers.map(provider => {
      const validation = this.validatePhoneNumber(provider.phoneNumber);
      return {
        phoneNumber: provider.phoneNumber,
        url: validation.isValid ? this.generateWhatsAppUrl(provider.phoneNumber, message) : '',
        isValid: validation.isValid
      };
    });
  }
}

export const whatsappService = new WhatsAppService();