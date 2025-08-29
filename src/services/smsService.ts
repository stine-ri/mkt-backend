import { config } from 'dotenv';

config(); 

interface SMSResponse {
  success: boolean;
  messageId?: string;
  error?: string;
}

export const sendSMS = async (phone: string, message: string): Promise<SMSResponse> => {
  try {
    // QuickSMS API integration
    const response = await fetch('https://quicksms.advantasms.com/api/sendsms', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        apikey: process.env.QUICKSMS_API_KEY,
        partnerID: process.env.QUICKSMS_PARTNER_ID,
        message: message,
        shortcode: process.env.QUICKSMS_SHORTCODE,
        mobile: phone.replace(/^0/, '254') // Convert to international format
      })
    });

    const data = await response.json();

    if (data.responses && data.responses[0] && data.responses[0]['response-code'] === '200') {
      return {
        success: true,
        messageId: data.responses[0].messageid
      };
    } else {
      console.error('QuickSMS API error:', data);
      return {
        success: false,
        error: data.responses?.[0]?.['response-description'] || 'Failed to send SMS'
      };
    }
  } catch (error) {
    console.error('SMS sending error:', error);
    return {
      success: false,
      error: 'Network error while sending SMS'
    };
  }
};

// Alternative method using XML (if required by QuickSMS)
export const sendSMSXml = async (phone: string, message: string): Promise<SMSResponse> => {
  try {
    const xmlBody = `<?xml version="1.0" encoding="UTF-8"?>
      <message>
        <username>${process.env.QUICKSMS_USERNAME}</username>
        <password>${process.env.QUICKSMS_PASSWORD}</password>
        <sender>${process.env.QUICKSMS_SENDER_ID}</sender>
        <text>${message}</text>
        <mobile>${phone}</mobile>
      </message>`;

    const response = await fetch('https://quicksms.advantasms.com/api/sendsms', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/xml',
      },
      body: xmlBody
    });

    const textResponse = await response.text();
    
    // Parse XML response (you might want to use an XML parser)
    if (textResponse.includes('Success')) {
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