// services/smsService.ts - CORRECTED QuickSMS implementation
import { config } from 'dotenv';

config();

interface SMSResponse {
  success: boolean;
  messageId?: string;
  error?: string;
  provider?: string;
}

// Format phone number to international format
function formatPhoneNumber(phone: string): string {
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('0')) return '254' + cleaned.substring(1);
  if (!cleaned.startsWith('254')) return '254' + cleaned;
  return cleaned;
}

// CORRECTED QuickSMS implementation
const sendQuickSMS = async (phone: string, message: string): Promise<SMSResponse> => {
  try {
    const formattedPhone = formatPhoneNumber(phone);
    
    // Use the correct endpoint and format based on AdvantaSMS documentation
    const endpoint = 'https://quicksms.advantasms.com/api/services/sendsms';
    
    const requestBody = {
      apikey: process.env.QUICKSMS_API_KEY,
      partnerID: process.env.QUICKSMS_PARTNER_ID,
      message: message,
      shortcode: process.env.QUICKSMS_SHORTCODE,
      mobile: formattedPhone
    };

    console.log('🔧 QuickSMS Request:', JSON.stringify(requestBody, null, 2));
    
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(requestBody)
    });

    console.log('📊 QuickSMS Response Status:', response.status);
    
    const responseText = await response.text();
    console.log('📋 QuickSMS Response Text:', responseText);

    let data;
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      return { 
        success: false, 
        error: `Invalid JSON response: ${responseText}`,
        provider: 'QuickSMS'
      };
    }

    if (response.ok) {
      // Handle different success response formats
      if (data.responses && Array.isArray(data.responses)) {
        const firstResponse = data.responses[0];
        if (firstResponse['response-code'] === '200') {
          return {
            success: true,
            messageId: firstResponse.messageid,
            provider: 'QuickSMS'
          };
        }
      } else if (data.status === 'Success') {
        return {
          success: true,
          messageId: data.messageId || `quick-${Date.now()}`,
          provider: 'QuickSMS'
        };
      }
    }

    return { 
      success: false, 
      error: data.message || data.error || 'Unknown QuickSMS error',
      provider: 'QuickSMS'
    };
    
  } catch (error) {
    console.error('🔥 QuickSMS error:', error);
    return { 
      success: false, 
      error: 'QuickSMS network error',
      provider: 'QuickSMS'
    };
  }
};

// SIMPLIFIED VERSION - Use only QuickSMS for now
export const sendSMS = async (phone: string, message: string): Promise<SMSResponse> => {
  console.log('📱 Attempting to send SMS to:', formatPhoneNumber(phone));
  console.log('📝 Message:', message);

  // For now, only try QuickSMS
  try {
    console.log('🔄 Trying QuickSMS...');
    const result = await sendQuickSMS(phone, message);
    
    if (result.success) {
      console.log('✅ SMS sent successfully via QuickSMS');
      return result;
    } else {
      console.log('❌ QuickSMS failed:', result.error);
      return result;
    }
  } catch (error) {
    console.log('💥 QuickSMS threw error:', error);
    return {
      success: false,
      error: 'QuickSMS failed',
      provider: 'QuickSMS'
    };
  }
};

// Mock SMS service for development
export const sendMockSMS = async (phone: string, message: string): Promise<SMSResponse> => {
  console.log('📱 MOCK SMS:', { 
    to: formatPhoneNumber(phone), 
    message: message,
    timestamp: new Date().toISOString()
  });
  
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  return { 
    success: true, 
    messageId: 'mock-' + Date.now(),
    provider: 'Mock'
  };
};