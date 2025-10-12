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

    return `🛎️ *NEW SERVICE REQUEST* 🛎️\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `📋 *Service:* ${serviceName}\n` +
      `━━━━━━━━━━━━━━━━━━━━\n\n` +
      `👤 *Client Details:*\n` +
      `   • Name: ${clientName}\n` +
      `   • Phone: ${clientPhone}\n` +
      `   • Location: ${location}\n\n` +
      `💰 *Budget:* ${budget ? `KES ${budget}` : 'Negotiable'}\n` +
      `📅 *Preferred Date:* ${preferredDate || 'Flexible'}\n` +
      `📝 *Description:*\n${description}\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `⚡ *Action Required:*\n` +
      `This request has been sent to multiple providers.\n` +
      `*Respond quickly to secure this client!*\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🌐 Visit: *quisells.com*\n` +
      `📧 Questions? Email: *ombongidiaz@gmail.com*\n\n` +
      `Powered by Quisells Marketplace 🚀`;
  }

  // Generate WhatsApp URL (for direct browser opening)
  generateWhatsAppUrl(phoneNumber: string, message: string): string {
    // Clean the phone number - remove all non-digit characters
    let cleanPhone = phoneNumber.replace(/\D/g, '');
    
    // If phone starts with 0, replace with country code (254 for Kenya)
    if (cleanPhone.startsWith('0')) {
      cleanPhone = '254' + cleanPhone.substring(1);
    }
    
    // If phone doesn't have country code and doesn't start with 254, add it
    if (!cleanPhone.startsWith('254') && cleanPhone.length === 9) {
      cleanPhone = '254' + cleanPhone;
    }
    
    console.log(`WhatsApp URL generation: ${phoneNumber} → ${cleanPhone}`);
    
    // Encode the message for URL
    const encodedMessage = encodeURIComponent(message);
    
    // Use the wa.me format which is more reliable
    const url = `https://wa.me/${cleanPhone}?text=${encodedMessage}`;
    
    console.log(`Generated WhatsApp URL (first 150 chars): ${url.substring(0, 150)}...`);
    
    return url;
  }

  // Validate phone number for WhatsApp
  validatePhoneNumber(phoneNumber: string): { isValid: boolean; cleanNumber: string } {
    const cleanNumber = phoneNumber.replace(/\D/g, '');
    
    // Basic validation - you can enhance this based on your needs
    const isValid = cleanNumber.length >= 9 && cleanNumber.length <= 15;
    
    return {
      isValid,
      cleanNumber: isValid ? cleanNumber : ''
    };
  }

  // Generate multiple WhatsApp URLs for batch notifications
  generateBatchWhatsAppUrls(
    providers: Array<{ phoneNumber: string; firstName?: string; lastName?: string }>, 
    message: string
  ): Array<{ 
    phoneNumber: string; 
    url: string; 
    isValid: boolean;
    providerName?: string;
  }> {
    return providers.map(provider => {
      const validation = this.validatePhoneNumber(provider.phoneNumber);
      return {
        phoneNumber: provider.phoneNumber,
        url: validation.isValid ? this.generateWhatsAppUrl(provider.phoneNumber, message) : '',
        isValid: validation.isValid,
        providerName: provider.firstName && provider.lastName 
          ? `${provider.firstName} ${provider.lastName}` 
          : undefined
      };
    });
  }
}

export const whatsappService = new WhatsAppService();