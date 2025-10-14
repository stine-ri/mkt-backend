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
      messageLength: message.length 
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
    console.log('📊 QuickSMS Notification Response:', response.status);

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
    console.error('🔥 QuickSMS Notification error:', error);
    return { 
      success: false, 
      error: 'QuickSMS network error',
      provider: 'QuickSMS',
      details: { error: error instanceof Error ? error.message : String(error) }
    };
  }
};

// Alternative QuickSMS implementation
const sendQuickSMSAlternative = async (phone: string, message: string): Promise<SMSResponse> => {
  try {
    const formattedPhone = formatPhoneNumber(phone);
    
    const endpoint = 'https://quicksms.advantasms.com/api/services/sendsms';
    
    const requestBody = {
      apikey: process.env.QUICKSMS_API_KEY,
      partnerID: process.env.QUICKSMS_PARTNER_ID,
      username: process.env.QUICKSMS_USERNAME,
      password: process.env.QUICKSMS_PASSWORD,
      message: message,
      sender: process.env.QUICKSMS_SENDER_ID || 'QUISELLS',
      mobile: formattedPhone
    };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(requestBody)
    });

    const responseText = await response.text();
    console.log('📊 Alternative Notification Response:', response.status);

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

// Main SMS notification function
export const sendSMSNotification = async (phone: string, message: string): Promise<SMSResponse> => {
  console.log('📱 Attempting to send SMS notification to:', formatPhoneNumber(phone));
  console.log('📝 Message length:', message.length);

  // Try QuickSMS first
  const quickSMSResult = await sendQuickSMS(phone, message);
  
  if (quickSMSResult.success) {
    console.log('✅ SMS notification sent successfully via QuickSMS');
    return quickSMSResult;
  }
  
  console.log('❌ QuickSMS failed:', quickSMSResult.error);

  // If shortcode is the issue, try alternative method
  if (quickSMSResult.error?.includes('Shortcode') || quickSMSResult.error?.includes('Sender ID')) {
    console.log('🔄 Trying QuickSMS without shortcode...');
    const altResult = await sendQuickSMSAlternative(phone, message);
    
    if (altResult.success) {
      console.log('✅ SMS notification sent successfully via QuickSMS alternative');
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

// Bulk SMS notification to multiple providers
export const sendBulkSMSNotifications = async (
  providers: Array<{ phoneNumber: string; firstName?: string; lastName?: string }>, 
  message: string
): Promise<Array<{ 
  phoneNumber: string; 
  success: boolean;
  error?: string;
  providerName?: string;
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
        : undefined
    });
    
    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  const successful = results.filter(r => r.success).length;
  console.log(`✅ Bulk SMS completed: ${successful}/${providers.length} successful`);
  
  return results;
};