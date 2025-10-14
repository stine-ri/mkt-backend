// services/smsNotificationService.ts
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

// QuickSMS implementation for notifications
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

    console.log('🔧 QuickSMS Notification Request:', { 
      phone: formattedPhone,
      messageLength: message.length,
      hasApiKey: !!process.env.QUICKSMS_API_KEY,
      hasPartnerId: !!process.env.QUICKSMS_PARTNER_ID
    });
    
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(requestBody)
    });

    const responseText = await response.text();
    console.log('📊 QuickSMS Notification Response Status:', response.status);
    console.log('📊 QuickSMS Response Body:', responseText);

    let data;
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      console.error('🔥 Failed to parse QuickSMS response as JSON');
      return { 
        success: false, 
        error: `Invalid JSON response: ${responseText}`,
        provider: 'QuickSMS',
        details: { responseText, status: response.status }
      };
    }

    // FIXED: Better response code checking
    const responseCode = data['response-code'] || data['responseCode'] || data['code'];
    
    console.log('Response code received:', responseCode, 'Type:', typeof responseCode);

    // Handle success cases
    if ((response.ok && responseCode === 200) || responseCode === '200') {
      console.log('✅ SMS sent successfully');
      return {
        success: true,
        messageId: data.messageid || data.messageId || `quick-${Date.now()}`,
        provider: 'QuickSMS'
      };
    }

    // Handle specific error cases with detailed logging
    let errorMessage = 'Unknown QuickSMS error';
    let errorDetails = {};

    if (responseCode === 1003 || responseCode === '1003') {
      console.error('🔥 Validation error from QuickSMS');
      errorDetails = data.errors || {};
      
      if (data.errors?.shortcode) {
        errorMessage = `Shortcode error: ${data.errors.shortcode.Shortcode || 'Sender ID is inactive'}`;
      } else if (data.errors?.mobile) {
        errorMessage = `Invalid phone number: ${data.errors.mobile[0] || 'Phone number format error'}`;
      } else if (data.errors?.apikey) {
        errorMessage = `API Key error: ${data.errors.apikey[0] || 'Invalid API key'}`;
      } else {
        errorMessage = 'Validation errors occurred: ' + JSON.stringify(data.errors);
      }
    } else if (responseCode === 1002 || responseCode === '1002') {
      errorMessage = 'Authentication failed: Invalid API key or Partner ID';
      console.error('🔥 Authentication error - check QUICKSMS_API_KEY and QUICKSMS_PARTNER_ID');
    } else if (responseCode === 1008 || responseCode === '1008') {
      errorMessage = 'Insufficient balance on QuickSMS account';
      console.error('🔥 Insufficient balance');
    } else if (data['response-description']) {
      errorMessage = data['response-description'];
    } else if (data.message) {
      errorMessage = data.message;
    } else if (data.error) {
      errorMessage = data.error;
    }

    console.error(`❌ QuickSMS Error: ${errorMessage}`);

    return { 
      success: false, 
      error: errorMessage,
      provider: 'QuickSMS',
      details: { ...data, errorDetails }
    };
    
  } catch (error) {
    console.error('🔥 QuickSMS Notification error:', error);
    return { 
      success: false, 
      error: `QuickSMS network error: ${error instanceof Error ? error.message : String(error)}`,
      provider: 'QuickSMS',
      details: { error: error instanceof Error ? error.message : String(error) }
    };
  }
};

// Alternative QuickSMS implementation using query parameters
const sendQuickSMSAlternative = async (phone: string, message: string): Promise<SMSResponse> => {
  try {
    const formattedPhone = formatPhoneNumber(phone);
    
    // Try URL encoded form approach as alternative
    const endpoint = 'https://quicksms.advantasms.com/api/services/sendsms';
    
    const params = new URLSearchParams({
      apikey: process.env.QUICKSMS_API_KEY || '',
      partnerID: process.env.QUICKSMS_PARTNER_ID || '',
      message: message,
      sender: process.env.QUICKSMS_SENDER_ID || 'QUISELLS',
      mobile: formattedPhone
    });

    console.log('🔄 Trying QuickSMS alternative method with sender ID');

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString()
    });

    const responseText = await response.text();
    console.log('📊 Alternative Response Status:', response.status);
    console.log('📊 Alternative Response Body:', responseText);

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

    const responseCode = data['response-code'] || data['responseCode'];
    
    if (responseCode === 200 || responseCode === '200' || data.status === 'Success') {
      console.log('✅ SMS sent successfully via alternative method');
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
      error: `QuickSMS alternative network error: ${error instanceof Error ? error.message : String(error)}`,
      provider: 'QuickSMS-Alt'
    };
  }
};

// Main SMS notification function
export const sendSMSNotification = async (phone: string, message: string): Promise<SMSResponse> => {
  console.log('📱 Attempting to send SMS notification to:', formatPhoneNumber(phone));
  console.log('📝 Message length:', message.length);

  // Validate phone number first
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length < 9) {
    return {
      success: false,
      error: `Invalid phone number: ${phone} (too short after cleaning)`,
      provider: 'QuickSMS'
    };
  }

  // Try QuickSMS first
  const quickSMSResult = await sendQuickSMS(phone, message);
  
  if (quickSMSResult.success) {
    console.log('✅ SMS notification sent successfully via QuickSMS');
    return quickSMSResult;
  }
  
  console.log('❌ QuickSMS failed:', quickSMSResult.error);

  // If authentication or shortcode is the issue, try alternative method
  if (quickSMSResult.error?.includes('Shortcode') || 
      quickSMSResult.error?.includes('Sender ID') ||
      quickSMSResult.error?.includes('Authentication')) {
    console.log('🔄 Trying QuickSMS alternative method...');
    const altResult = await sendQuickSMSAlternative(phone, message);
    
    if (altResult.success) {
      console.log('✅ SMS notification sent successfully via QuickSMS alternative');
      return altResult;
    }
    
    console.log('❌ QuickSMS alternative failed:', altResult.error);
    return altResult;
  }

  // All methods failed
  console.log('💀 All QuickSMS methods failed');
  return {
    success: false,
    error: quickSMSResult.error || 'QuickSMS failed: Unknown error',
    provider: 'QuickSMS',
    details: { quickSMS: quickSMSResult }
  };
};

// Bulk SMS notification to multiple providers
export const sendBulkSMSNotifications = async (
  providers: Array<{ phoneNumber: string; firstName?: string; lastName?: string; id?: number }>, 
  message: string
): Promise<Array<{ 
  phoneNumber: string; 
  success: boolean;
  error?: string;
  providerName?: string;
  providerId?: number;
}>> => {
  console.log(`📨 Sending bulk SMS notifications to ${providers.length} providers`);
  
  const results = [];
  
  for (const provider of providers) {
    console.log(`📲 Sending to ${provider.firstName} ${provider.lastName}: ${provider.phoneNumber}`);
    
    const result = await sendSMSNotification(provider.phoneNumber, message);
    
    results.push({
      phoneNumber: provider.phoneNumber,
      success: result.success,
      error: result.error,
      providerName: provider.firstName && provider.lastName 
        ? `${provider.firstName} ${provider.lastName}` 
        : undefined,
      providerId: provider.id
    });
    
    // Delay between SMS to avoid rate limiting (100ms between each)
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  const successful = results.filter(r => r.success).length;
  console.log(`✅ Bulk SMS completed: ${successful}/${providers.length} successful`);
  
  return results;
};