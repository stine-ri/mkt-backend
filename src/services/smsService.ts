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

export const sendSMS = async (phone: string, message: string): Promise<SMSResponse> => {
  try {
    const formattedPhone = formatPhoneNumber(phone);
    
    console.log('Sending SMS to:', formattedPhone);
    console.log('Message:', message);
    console.log('API Key:', process.env.QUICKSMS_API_KEY ? 'Present' : 'Missing');
    console.log('Sender ID:', process.env.QUICKSMS_SENDER_ID);

    // QuickSMS API integration - try different endpoints
    const apiUrl = 'https://quicksms.advantasms.com/api/sendsms';
    
    const requestBody = {
      apikey: process.env.QUICKSMS_API_KEY,
      partnerID: process.env.QUICKSMS_PARTNER_ID,
      message: message,
      shortcode: process.env.QUICKSMS_SHORTCODE,
      mobile: formattedPhone
    };

    console.log('API Request:', requestBody);

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(requestBody)
    });

    console.log('API Response Status:', response.status);
    
    let data;
    try {
      data = await response.json();
      console.log('API Response Data:', data);
    } catch (parseError) {
      const textResponse = await response.text();
      console.log('API Response Text:', textResponse);
      throw new Error(`Failed to parse response: ${textResponse}`);
    }

    // Check different possible success responses
    if (response.ok) {
      if (data.responses && data.responses[0] && data.responses[0]['response-code'] === '200') {
        return {
          success: true,
          messageId: data.responses[0].messageid
        };
      } else if (data.status === 'Success') {
        return {
          success: true,
          messageId: data.messageId || `quick-${Date.now()}`
        };
      } else if (data.success) {
        return {
          success: true,
          messageId: data.messageId || `quick-${Date.now()}`
        };
      }
    }

    console.error('QuickSMS API error:', data);
    return {
      success: false,
      error: data.message || data.error || data.responses?.[0]?.['response-description'] || 'Failed to send SMS'
    };

  } catch (error) {
    console.error('SMS sending error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Network error while sending SMS'
    };
  }
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