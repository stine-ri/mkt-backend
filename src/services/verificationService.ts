// services/verificationService.ts
import { db } from '../drizzle/db.js';
import { smsVerificationCodes } from '../drizzle/schema.js';
import { eq, and, gt } from 'drizzle-orm';

// Store recent codes for debugging
const recentCodes = new Map<string, { code: string; expiresAt: Date; phone: string }>();

export const logVerificationCode = (phone: string, code: string, expiresAt: Date) => {
  const formattedPhone = formatPhoneNumber(phone);
  
  console.log('\n📋 VERIFICATION CODE');
  console.log('────────────────────');
  console.log(`Phone: ${formattedPhone}`);
  console.log(`Code: ${code}`);
  console.log(`Expires: ${expiresAt.toLocaleString()}`);
  console.log('────────────────────\n');
  
  // Store for debugging
  recentCodes.set(formattedPhone, { code, expiresAt, phone: formattedPhone });
};

export const getRecentCodes = () => {
  return Array.from(recentCodes.values());
};

export const verifyStoredCode = async (phone: string, code: string): Promise<boolean> => {
  try {
    const formattedPhone = formatPhoneNumber(phone);
    const verificationCode = await db.query.smsVerificationCodes.findFirst({
      where: and(
        eq(smsVerificationCodes.phone, formattedPhone),
        eq(smsVerificationCodes.code, code),
        eq(smsVerificationCodes.used, false),
        gt(smsVerificationCodes.expiresAt, new Date())
      )
    });

    return !!verificationCode;
  } catch (error) {
    console.error('Error verifying code:', error);
    return false;
  }
};

// Helper function
function formatPhoneNumber(phone: string): string {
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('0')) return '254' + cleaned.substring(1);
  if (!cleaned.startsWith('254')) return '254' + cleaned;
  return cleaned;
}