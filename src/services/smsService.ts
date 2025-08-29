// services/smsService.ts
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

// 1. QuickSMS/Advanta (Updated with correct endpoint)
const sendQuickSMS = async (phone: string, message: string): Promise<SMSResponse> => {
  try {
    const formattedPhone = formatPhoneNumber(phone);
    
    // Use the correct bulk SMS endpoint
    const endpoint = 'https://quicksms.advantasms.com/api/services/sendbulk/';
    
    const requestBody = {
      count: 1,
      smslist: [{
        partnerID: process.env.QUICKSMS_PARTNER_ID,
        apikey: process.env.QUICKSMS_API_KEY,
        pass_type: "plain",
        clientsmsid: Date.now(),
        mobile: formattedPhone,
        message: message,
        shortcode: process.env.QUICKSMS_SHORTCODE || process.env.QUICKSMS_SENDER_ID
      }]
    };

    console.log('Trying QuickSMS endpoint:', endpoint);
    
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(requestBody)
    });

    console.log('QuickSMS response status:', response.status);
    
    if (response.ok) {
      const data = await response.json();
      console.log('QuickSMS response:', data);
      
      // Check for success in response
      if (data.success || data.status === 'success' || 
          (data.responses && data.responses[0]?.status === 'success')) {
        return {
          success: true,
          messageId: data.responses?.[0]?.messageid || `quick-${Date.now()}`,
          provider: 'QuickSMS'
        };
      }
    }

    const errorText = await response.text();
    console.log('QuickSMS error response:', errorText);
    return { success: false, error: errorText };
    
  } catch (error) {
    console.error('QuickSMS error:', error);
    return { success: false, error: 'QuickSMS failed' };
  }
};

// 2. Africa's Talking SMS
const sendAfricasTalking = async (phone: string, message: string): Promise<SMSResponse> => {
  try {
    const formattedPhone = `+${formatPhoneNumber(phone)}`;
    
    if (!process.env.AFRICAS_TALKING_API_KEY || !process.env.AFRICAS_TALKING_USERNAME) {
      return { success: false, error: 'Africa\'s Talking not configured' };
    }

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
        from: process.env.AFRICAS_TALKING_SENDER_ID || 'QuiSells'
      })
    });

    if (response.ok) {
      const data = await response.json();
      console.log('Africa\'s Talking success:', data);
      
      if (data.SMSMessageData?.Recipients?.[0]?.status === 'Success') {
        return {
          success: true,
          messageId: data.SMSMessageData.Recipients[0].messageId,
          provider: 'AfricasTalking'
        };
      }
    }

    return { success: false, error: 'Africa\'s Talking failed' };
  } catch (error) {
    return { success: false, error: 'Africa\'s Talking network error' };
  }
};

// 3. SMS.to (Alternative provider)
const sendSMSTo = async (phone: string, message: string): Promise<SMSResponse> => {
  try {
    const formattedPhone = formatPhoneNumber(phone);
    
    if (!process.env.SMSTO_API_KEY) {
      return { success: false, error: 'SMS.to not configured' };
    }

    const response = await fetch('https://api.sms.to/sms/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.SMSTO_API_KEY}`,
      },
      body: JSON.stringify({
        to: formattedPhone,
        message: message,
        sender_id: process.env.SMSTO_SENDER_ID || 'QuiSells'
      })
    });

    if (response.ok) {
      const data = await response.json();
      return {
        success: true,
        messageId: data.message_id,
        provider: 'SMSTo'
      };
    }

    return { success: false, error: 'SMS.to failed' };
  } catch (error) {
    return { success: false, error: 'SMS.to network error' };
  }
};

// 4. Termii (Nigerian but works in Kenya)
const sendTermii = async (phone: string, message: string): Promise<SMSResponse> => {
  try {
    const formattedPhone = formatPhoneNumber(phone);
    
    if (!process.env.TERMII_API_KEY) {
      return { success: false, error: 'Termii not configured' };
    }

    const response = await fetch('https://api.ng.termii.com/api/sms/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: formattedPhone,
        from: process.env.TERMII_SENDER_ID || 'QuiSells',
        sms: message,
        type: 'plain',
        api_key: process.env.TERMII_API_KEY,
        channel: 'generic'
      })
    });

    if (response.ok) {
      const data = await response.json();
      return {
        success: true,
        messageId: data.message_id,
        provider: 'Termii'
      };
    }

    return { success: false, error: 'Termii failed' };
  } catch (error) {
    return { success: false, error: 'Termii network error' };
  }
};

// 5. Movetech SMS (Kenya local provider)
const sendMovetech = async (phone: string, message: string): Promise<SMSResponse> => {
  try {
    const formattedPhone = formatPhoneNumber(phone);
    
    if (!process.env.MOVETECH_API_KEY) {
      return { success: false, error: 'Movetech not configured' };
    }

    const response = await fetch('https://api.movesms.co.ke/v1/sms/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.MOVETECH_API_KEY}`,
      },
      body: JSON.stringify({
        recipient: formattedPhone,
        message: message,
        sender: process.env.MOVETECH_SENDER_ID || 'QuiSells'
      })
    });

    if (response.ok) {
      const data = await response.json();
      return {
        success: true,
        messageId: data.id || `movetech-${Date.now()}`,
        provider: 'Movetech'
      };
    }

    return { success: false, error: 'Movetech failed' };
  } catch (error) {
    return { success: false, error: 'Movetech network error' };
  }
};

// Main SMS function with multiple providers
export const sendSMS = async (phone: string, message: string): Promise<SMSResponse> => {
  console.log('📱 Attempting to send SMS to:', formatPhoneNumber(phone));
  console.log('📝 Message:', message);

  // Array of SMS providers to try in order
  const providers = [
    { name: 'QuickSMS', fn: sendQuickSMS },
    { name: 'AfricasTalking', fn: sendAfricasTalking },
    { name: 'Termii', fn: sendTermii },
    { name: 'Movetech', fn: sendMovetech },
    { name: 'SMSTo', fn: sendSMSTo }
  ];

  let lastError = 'All providers failed';

  // Try each provider until one succeeds
  for (const provider of providers) {
    try {
      console.log(`🔄 Trying ${provider.name}...`);
      const result = await provider.fn(phone, message);
      
      if (result.success) {
        console.log(`✅ SMS sent successfully via ${provider.name}`);
        return { ...result, provider: provider.name };
      } else {
        console.log(`❌ ${provider.name} failed:`, result.error);
        lastError = result.error || `${provider.name} failed`;
      }
    } catch (error) {
      console.log(`💥 ${provider.name} threw error:`, error);
      lastError = `${provider.name} threw error`;
    }
  }

  // If all providers fail, return failure
  console.error('🚨 All SMS providers failed');
  return {
    success: false,
    error: lastError
  };
};

// Legacy XML method (keeping for backward compatibility)
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

    const response = await fetch('https://quicksms.advantasms.com/api/services/sendsingle/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/xml',
      },
      body: xmlBody
    });

    const textResponse = await response.text();
    console.log('XML API Response:', textResponse);
    
    if (textResponse.includes('Success') || response.ok) {
      return { success: true, provider: 'QuickSMS-XML' };
    } else {
      return { 
        success: false, 
        error: textResponse,
        provider: 'QuickSMS-XML'
      };
    }
  } catch (error) {
    console.error('SMS XML sending error:', error);
    return {
      success: false,
      error: 'Network error while sending SMS via XML'
    };
  }
};

// Mock SMS service for development/testing
export const sendMockSMS = async (phone: string, message: string): Promise<SMSResponse> => {
  console.log('📱 MOCK SMS:', { 
    to: formatPhoneNumber(phone), 
    message: message,
    timestamp: new Date().toISOString()
  });
  
  // Simulate API delay
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  return { 
    success: true, 
    messageId: 'mock-' + Date.now(),
    provider: 'Mock'
  };
};