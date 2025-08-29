// services/smsService.ts
import { config } from 'dotenv';

config();

interface SMSResponse {
  success: boolean;
  messageId?: string;
  error?: string;
}

// Format phone number to international format
function formatPhoneNumber(phone: string): string {
  // Remove any non-digit characters
  const cleaned = phone.replace(/\D/g, '');
  
  // If it starts with 0, replace with 254
  if (cleaned.startsWith('0')) {
    return '254' + cleaned.substring(1);
  }
  
  // If it doesn't start with 254, add it
  if (!cleaned.startsWith('254')) {
    return '254' + cleaned;
  }
  
  return cleaned;
}

// services/smsService.ts - Updated with correct endpoints
export const sendSMS = async (phone: string, message: string): Promise<SMSResponse> => {
  try {
    const formattedPhone = formatPhoneNumber(phone);
    
    console.log('Sending SMS to:', formattedPhone);
    console.log('Message:', message);

    // Try different QuickSMS API endpoints
    const apiEndpoints = [
      'https://quicksms.advantasms.com/api/v3/sendsms',
      'https://quicksms.advantasms.com/api/v2/sendsms',
      'https://quicksms.advantasms.com/api/v1/sendsms',
      'https://quicksms.advantasms.com/sendsms',
      'https://api.advantasms.com/sendsms',
    ];

    const requestBody = {
      apikey: process.env.QUICKSMS_API_KEY,
      partnerID: process.env.QUICKSMS_PARTNER_ID,
      message: message,
      shortcode: process.env.QUICKSMS_SHORTCODE,
      mobile: formattedPhone
    };

    let lastError;
    
    // Try each endpoint until one works
    for (const endpoint of apiEndpoints) {
      try {
        console.log('Trying endpoint:', endpoint);
        
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify(requestBody)
        });

        console.log('Endpoint response status:', response.status);
        
        if (response.ok) {
          const data = await response.json();
          console.log('Success with endpoint:', endpoint, data);
          
          if (data.responses?.[0]?.['response-code'] === '200' || data.status === 'Success') {
            return {
              success: true,
              messageId: data.responses?.[0]?.messageid || `quick-${Date.now()}`
            };
          }
        }
      } catch (error) {
        lastError = error;
        console.log('Endpoint failed:', endpoint, error);
        continue; // Try next endpoint
      }
    }

    // If all endpoints failed, try alternative SMS providers as fallback
    console.log('All QuickSMS endpoints failed, trying alternative providers...');
    return await tryAlternativeSMSProviders(phone, message);

  } catch (error) {
    console.error('SMS sending error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Network error while sending SMS'
    };
  }
};

// Alternative SMS providers as fallback
const tryAlternativeSMSProviders = async (phone: string, message: string): Promise<SMSResponse> => {
  const formattedPhone = formatPhoneNumber(phone);
  
  // Try Africa's Talking as fallback (you'd need to sign up for an account)
  if (process.env.AFRICAS_TALKING_API_KEY && process.env.AFRICAS_TALKING_USERNAME) {
    try {
      const response = await fetch('https://api.africastalking.com/version1/messaging', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
          'apiKey': process.env.AFRICAS_TALKING_API_KEY,
        },
        body: new URLSearchParams({
          username: process.env.AFRICAS_TALKING_USERNAME,
          to: formattedPhone,
          message: message,
          from: process.env.QUICKSMS_SENDER_ID || 'SMSAuth'
        })
      });

      if (response.ok) {
        const data = await response.json();
        return { success: true, messageId: data.SMSMessageData?.Recipients?.[0]?.messageId };
      }
    } catch (error) {
      console.log('Africa\'s Talking failed:', error);
    }
  }

  return {
    success: false,
    error: 'All SMS providers failed. Please contact support.'
  };
};
// Alternative: XML format (some SMS providers prefer this)
export const sendSMSXml = async (phone: string, message: string): Promise<SMSResponse> => {
  try {
    const formattedPhone = formatPhoneNumber(phone);
    
    const xmlBody = `<?xml version="1.0" encoding="UTF-8"?>
      <message>
        <username>${process.env.QUICKSMS_USERNAME}</username>
        <password>${process.env.QUICKSMS_PASSWORD}</password>
        <sender>${process.env.QUICKSMS_SENDER_ID}</sender>
        <text>${message}</text>
        <mobile>${formattedPhone}</mobile>
      </message>`;

    const response = await fetch('https://quicksms.advantasms.com/api/sendsms', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/xml',
      },
      body: xmlBody
    });

    const textResponse = await response.text();
    console.log('XML API Response:', textResponse);
    
    if (textResponse.includes('Success') || response.ok) {
      return { success: true };
    } else {
      return { 
        success: false, 
        error: textResponse 
      };
    }
  } catch (error) {
    console.error('SMS XML sending error:', error);
    return {
      success: false,
      error: 'Network error while sending SMS'
    };
  }
};

// Mock SMS service for development/testing
export const sendMockSMS = async (phone: string, message: string): Promise<SMSResponse> => {
  console.log('📱 MOCK SMS:', { 
    to: phone, 
    message: message,
    formatted: formatPhoneNumber(phone),
    timestamp: new Date().toISOString()
  });
  
  // Simulate API delay
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  return { 
    success: true, 
    messageId: 'mock-' + Date.now() 
  };
};