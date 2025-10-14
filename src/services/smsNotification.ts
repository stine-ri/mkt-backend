// services/smsNotificationService.ts - FIXED VERSION
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

// QuickSMS implementation for notifications - FIXED RESPONSE PARSING
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
    console.log('📊 QuickSMS Response Status:', response.status);
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

    // FIXED: Handle the responses array format from QuickSMS
    if (data.responses && Array.isArray(data.responses)) {
      const firstResponse = data.responses[0];
      
      // Check if the response indicates success
      if (firstResponse['response-code'] === 200 || firstResponse['response-description'] === 'Success') {
        console.log('✅ SMS sent successfully to', formattedPhone, 'Message ID:', firstResponse.messageid);
        return {
          success: true,
          messageId: firstResponse.messageid || `quick-${Date.now()}`,
          provider: 'QuickSMS',
          details: data
        };
      } else {
        // Handle error in responses array
        const errorMessage = firstResponse['response-description'] || 'SMS delivery failed';
        console.error('❌ SMS delivery failed:', errorMessage);
        return {
          success: false,
          error: errorMessage,
          provider: 'QuickSMS',
          details: data
        };
      }
    }
    
    // FIXED: Handle direct response code (non-array format)
    const responseCode = data['response-code'] || data.responseCode;
    
    if (responseCode === 200 || responseCode === '200') {
      console.log('✅ SMS sent successfully to', formattedPhone);
      return {
        success: true,
        messageId: data.messageid || data.messageId || `quick-${Date.now()}`,
        provider: 'QuickSMS',
        details: data
      };
    }

    // Handle error cases
    let errorMessage = 'Unknown QuickSMS error';
    if (data['response-description']) {
      errorMessage = data['response-description'];
    } else if (data.message) {
      errorMessage = data.message;
    } else if (data.error) {
      errorMessage = data.error;
    }

    console.error('❌ QuickSMS Error:', errorMessage);
    return { 
      success: false, 
      error: errorMessage,
      provider: 'QuickSMS',
      details: data
    };
    
  } catch (error) {
    console.error('🔥 QuickSMS Network error:', error);
    return { 
      success: false, 
      error: `QuickSMS network error: ${error instanceof Error ? error.message : String(error)}`,
      provider: 'QuickSMS',
      details: { error: error instanceof Error ? error.message : String(error) }
    };
  }
};

// Main SMS notification function - SIMPLIFIED
export const sendSMSNotification = async (phone: string, message: string): Promise<SMSResponse> => {
  console.log('📱 Attempting to send SMS to:', formatPhoneNumber(phone));
  
  // Validate phone number
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length < 9) {
    return {
      success: false,
      error: `Invalid phone number: ${phone}`,
      provider: 'QuickSMS'
    };
  }

  // Send via QuickSMS
  const result = await sendQuickSMS(phone, message);
  
  if (result.success) {
    console.log('🎉 SMS sent successfully!');
  } else {
    console.log('❌ SMS failed:', result.error);
  }
  
  return result;
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
  details?: any;
}>> => {
  console.log(`📨 Sending bulk SMS to ${providers.length} providers`);
  
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
      providerId: provider.id,
      details: result.details
    });
    
    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  const successful = results.filter(r => r.success).length;
  console.log(`✅ Bulk SMS completed: ${successful}/${providers.length} successful`);
  
  return results;
};