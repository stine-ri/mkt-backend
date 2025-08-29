// services/smsService.ts - Enhanced with better error handling and fallback
import { config } from 'dotenv';

config();

interface SMSResponse {
  success: boolean;
  messageId?: string;
  error?: string;
  provider?: string;
  details?: any;
}

// Format phone number to international format
function formatPhoneNumber(phone: string): string {
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('0')) return '254' + cleaned.substring(1);
  if (!cleaned.startsWith('254')) return '254' + cleaned;
  return cleaned;
}

// Enhanced QuickSMS implementation with better error handling
const sendQuickSMS = async (phone: string, message: string): Promise<SMSResponse> => {
  try {
    const formattedPhone = formatPhoneNumber(phone);
    
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
        provider: 'QuickSMS',
        details: { responseText, status: response.status }
      };
    }

    // Handle success cases
    if (response.ok && data['response-code'] === 200) {
      return {
        success: true,
        messageId: data.messageid || `quick-${Date.now()}`,
        provider: 'QuickSMS'
      };
    }

    // Handle specific error cases
    let errorMessage = 'Unknown QuickSMS error';
    if (data['response-code'] === 1003) {
      if (data.errors?.shortcode) {
        errorMessage = `Shortcode error: ${data.errors.shortcode.Shortcode || 'Sender ID is inactive'}`;
      } else {
        errorMessage = 'Validation errors occurred';
      }
    } else if (data['response-description']) {
      errorMessage = data['response-description'];
    } else if (data.message) {
      errorMessage = data.message;
    }

    return { 
      success: false, 
      error: errorMessage,
      provider: 'QuickSMS',
      details: data
    };
    
  } catch (error) {
    console.error('🔥 QuickSMS error:', error);
    return { 
      success: false, 
      error: 'QuickSMS network error',
      provider: 'QuickSMS',
      details: { error: error instanceof Error ? error.message : String(error) }
    };
  }
};

// Alternative QuickSMS implementation (try with sender field instead)
const sendQuickSMSAlternative = async (phone: string, message: string): Promise<SMSResponse> => {
  try {
    const formattedPhone = formatPhoneNumber(phone);
    
    const endpoint = 'https://quicksms.advantasms.com/api/services/sendsms';
    
    // Try with 'sender' field instead of 'shortcode'
    const requestBody = {
      apikey: process.env.QUICKSMS_API_KEY,
      partnerID: process.env.QUICKSMS_PARTNER_ID,
      username: process.env.QUICKSMS_USERNAME,
      password: process.env.QUICKSMS_PASSWORD,
      message: message,
      sender: process.env.QUICKSMS_SENDER_ID || 'QUICKSMS', // Use sender instead of shortcode
      mobile: formattedPhone
    };

    console.log('🔧 QuickSMS Alternative Request:', JSON.stringify({
      ...requestBody,
      password: '***HIDDEN***'
    }, null, 2));
    
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(requestBody)
    });

    const responseText = await response.text();
    console.log('📊 Alternative Response:', response.status, responseText);

    let data;
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      return { 
        success: false, 
        error: `Invalid JSON response: ${responseText}`,
        provider: 'QuickSMS-Alt'
      };
    }

    if (data['response-code'] === 200 || data.status === 'Success') {
      return {
        success: true,
        messageId: data.messageid || data.messageId || `quick-alt-${Date.now()}`,
        provider: 'QuickSMS-Alt'
      };
    }

    return { 
      success: false, 
      error: data['response-description'] || data.message || 'Alternative method failed',
      provider: 'QuickSMS-Alt',
      details: data
    };
    
  } catch (error) {
    console.error('🔥 QuickSMS Alternative error:', error);
    return { 
      success: false, 
      error: 'QuickSMS alternative network error',
      provider: 'QuickSMS-Alt'
    };
  }
};



// Enhanced main SMS function with QuickSMS only
export const sendSMS = async (phone: string, message: string): Promise<SMSResponse> => {
  console.log('📱 Attempting to send SMS to:', formatPhoneNumber(phone));
  console.log('📝 Message:', message);

  // Try QuickSMS first
  console.log('🔄 Trying QuickSMS...');
  const quickSMSResult = await sendQuickSMS(phone, message);
  
  if (quickSMSResult.success) {
    console.log('✅ SMS sent successfully via QuickSMS');
    return quickSMSResult;
  }
  
  console.log('❌ QuickSMS failed:', quickSMSResult.error);

  // If shortcode is the issue, try alternative method
  if (quickSMSResult.error?.includes('Shortcode') || quickSMSResult.error?.includes('Sender ID')) {
    console.log('🔄 Trying QuickSMS without shortcode...');
    const altResult = await sendQuickSMSAlternative(phone, message);
    
    if (altResult.success) {
      console.log('✅ SMS sent successfully via QuickSMS alternative');
      return altResult;
    }
    
    console.log('❌ QuickSMS alternative failed:', altResult.error);
  }

  // All methods failed
  console.log('💀 QuickSMS methods failed');
  return {
    success: false,
    error: 'QuickSMS failed: ' + quickSMSResult.error,
    provider: 'QuickSMS',
    details: { quickSMS: quickSMSResult }
  };
};

// Mock SMS service for development (unchanged)
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

// Debug endpoint helper
export const getProviderStatus = async () => {
  return {
    quickSMS: {
      configured: !!(process.env.QUICKSMS_API_KEY && process.env.QUICKSMS_PARTNER_ID),
      hasCredentials: !!(process.env.QUICKSMS_USERNAME && process.env.QUICKSMS_PASSWORD),
      shortcode: process.env.QUICKSMS_SHORTCODE,
      senderId: process.env.QUICKSMS_SENDER_ID,
      hasShortcode: !!process.env.QUICKSMS_SHORTCODE,
      hasSenderId: !!process.env.QUICKSMS_SENDER_ID
    }
  };
};