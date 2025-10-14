// services/smsNotificationService.ts - UPDATED WITH DETAILED LOGGING
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

    console.log('🔧 QuickSMS Notification Request Details:', { 
      phone: phone,
      formattedPhone: formattedPhone,
      messageLength: message.length,
      hasApiKey: !!process.env.QUICKSMS_API_KEY,
      hasPartnerId: !!process.env.QUICKSMS_PARTNER_ID,
      hasShortcode: !!process.env.QUICKSMS_SHORTCODE,
      endpoint: endpoint
    });

    // Log the actual request (hide sensitive data)
    console.log('📤 QuickSMS Request Body (sanitized):', {
      ...requestBody,
      apikey: process.env.QUICKSMS_API_KEY ? '***SET***' : '***MISSING***',
      partnerID: process.env.QUICKSMS_PARTNER_ID ? '***SET***' : '***MISSING***'
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
    console.log('📊 QuickSMS Response Headers:', Object.fromEntries(response.headers.entries()));
    console.log('📊 QuickSMS Response Body:', responseText);

    let data;
    try {
      data = JSON.parse(responseText);
      console.log('📊 QuickSMS Parsed JSON:', data);
    } catch (e) {
      console.error('🔥 Failed to parse QuickSMS response as JSON. Raw response:', responseText);
      return { 
        success: false, 
        error: `Invalid JSON response: ${responseText}`,
        provider: 'QuickSMS',
        details: { 
          responseText, 
          status: response.status,
          headers: Object.fromEntries(response.headers.entries())
        }
      };
    }

    // FIXED: Better response code checking
    const responseCode = data['response-code'] || data['responseCode'] || data['code'] || data.status;
    
    console.log('🔍 QuickSMS Response Analysis:', {
      responseCode: responseCode,
      responseCodeType: typeof responseCode,
      responseOk: response.ok,
      hasResponseDescription: !!data['response-description'],
      hasMessage: !!data.message,
      hasErrors: !!data.errors
    });

    // Handle success cases
    if ((response.ok && responseCode === 200) || responseCode === '200' || data.responses?.[0]?.status === 'Success') {
      console.log('✅ SMS sent successfully to', formattedPhone);
      return {
        success: true,
        messageId: data.messageid || data.messageId || data.responses?.[0]?.messageid || `quick-${Date.now()}`,
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
      } else if (data.errors?.partnerID) {
        errorMessage = `Partner ID error: ${data.errors.partnerID[0] || 'Invalid Partner ID'}`;
      } else {
        errorMessage = 'Validation errors occurred: ' + JSON.stringify(data.errors);
      }
    } else if (responseCode === 1002 || responseCode === '1002') {
      errorMessage = 'Authentication failed: Invalid API key or Partner ID';
      console.error('🔥 Authentication error - check QUICKSMS_API_KEY and QUICKSMS_PARTNER_ID');
    } else if (responseCode === 1008 || responseCode === '1008') {
      errorMessage = 'Insufficient balance on QuickSMS account';
      console.error('🔥 Insufficient balance');
    } else if (responseCode === 1001 || responseCode === '1001') {
      errorMessage = 'Invalid mobile number format';
      console.error('🔥 Invalid mobile number format');
    } else if (data['response-description']) {
      errorMessage = data['response-description'];
    } else if (data.message) {
      errorMessage = data.message;
    } else if (data.error) {
      errorMessage = data.error;
    } else if (data.responses?.[0]?.status === 'Failed') {
      errorMessage = data.responses[0].description || 'SMS delivery failed';
    }

    console.error(`❌ QuickSMS Error for ${formattedPhone}: ${errorMessage}`);
    console.error('❌ Full error details:', data);

    return { 
      success: false, 
      error: errorMessage,
      provider: 'QuickSMS',
      details: { ...data, errorDetails, responseCode }
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

// Alternative QuickSMS implementation using different parameters
const sendQuickSMSAlternative = async (phone: string, message: string): Promise<SMSResponse> => {
  try {
    const formattedPhone = formatPhoneNumber(phone);
    
    // Try different parameter combinations
    const endpoint = 'https://quicksms.advantasms.com/api/services/sendsms';
    
    const requestBody = {
      apikey: process.env.QUICKSMS_API_KEY,
      partnerID: process.env.QUICKSMS_PARTNER_ID,
      message: message,
      shortcode: process.env.QUICKSMS_SHORTCODE || process.env.QUICKSMS_SENDER_ID || 'QUISELLS',
      mobile: formattedPhone
    };

    console.log('🔄 Trying QuickSMS alternative method with parameters:', {
      phone: formattedPhone,
      hasShortcode: !!process.env.QUICKSMS_SHORTCODE,
      hasSenderId: !!process.env.QUICKSMS_SENDER_ID,
      using: process.env.QUICKSMS_SHORTCODE || process.env.QUICKSMS_SENDER_ID || 'QUISELLS'
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
  console.log('\n🚀 ========== STARTING SMS SEND ==========');
  console.log('📱 Attempting to send SMS to:', phone);
  console.log('📱 Formatted phone:', formatPhoneNumber(phone));
  console.log('📝 Message preview:', message.substring(0, 100) + '...');
  console.log('📏 Message length:', message.length);

  // Validate phone number first
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length < 9) {
    console.error('❌ Phone number validation failed:', { original: phone, cleaned: cleaned });
    return {
      success: false,
      error: `Invalid phone number: ${phone} (too short after cleaning)`,
      provider: 'QuickSMS'
    };
  }

  console.log('✅ Phone number validated:', { original: phone, cleaned: cleaned, formatted: formatPhoneNumber(phone) });

  // Try QuickSMS first
  console.log('\n🔄 Attempting primary QuickSMS method...');
  const quickSMSResult = await sendQuickSMS(phone, message);
  
  if (quickSMSResult.success) {
    console.log('🎉 PRIMARY METHOD SUCCESS: SMS sent successfully via QuickSMS');
    return quickSMSResult;
  }
  
  console.log('❌ Primary method failed:', quickSMSResult.error);

  // If authentication or shortcode is the issue, try alternative method
  if (quickSMSResult.error?.includes('Shortcode') || 
      quickSMSResult.error?.includes('Sender ID') ||
      quickSMSResult.error?.includes('Authentication') ||
      quickSMSResult.error?.includes('Validation')) {
    console.log('\n🔄 Attempting alternative QuickSMS method...');
    const altResult = await sendQuickSMSAlternative(phone, message);
    
    if (altResult.success) {
      console.log('🎉 ALTERNATIVE METHOD SUCCESS: SMS sent successfully via QuickSMS alternative');
      return altResult;
    }
    
    console.log('❌ Alternative method failed:', altResult.error);
    return altResult;
  }

  // All methods failed
  console.log('💀 ALL METHODS FAILED for phone:', phone);
  console.log('========== SMS SEND COMPLETED ==========\n');
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
  details?: any;
}>> => {
  console.log(`\n📨 ========== BULK SMS STARTING ==========`);
  console.log(`📨 Sending to ${providers.length} providers`);
  console.log('👥 Providers:', providers.map(p => ({
    name: `${p.firstName} ${p.lastName}`,
    phone: p.phoneNumber,
    formatted: formatPhoneNumber(p.phoneNumber)
  })));
  
  const results = [];
  
  for (let i = 0; i < providers.length; i++) {
    const provider = providers[i];
    console.log(`\n📲 [${i + 1}/${providers.length}] Sending to ${provider.firstName} ${provider.lastName}: ${provider.phoneNumber}`);
    
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
    
    // Delay between SMS to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  
  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  
  console.log(`\n📊 ========== BULK SMS SUMMARY ==========`);
  console.log(`📊 Total: ${providers.length}`);
  console.log(`✅ Successful: ${successful}`);
  console.log(`❌ Failed: ${failed}`);
  
  if (failed > 0) {
    console.log('❌ Failed SMS details:');
    results.filter(r => !r.success).forEach((failedResult, index) => {
      console.log(`  ${index + 1}. ${failedResult.providerName}: ${failedResult.phoneNumber} - ${failedResult.error}`);
    });
  }
  
  console.log('========== BULK SMS COMPLETED ==========\n');
  
  return results;
};