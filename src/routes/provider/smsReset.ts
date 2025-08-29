import { Hono } from 'hono';
import { db } from '../../drizzle/db.js';
import { 
  smsVerificationCodes, 
  passwordResetTokens, 
  users, 
  Authentication 
} from '../../drizzle/schema.js';
import { eq, and, gt } from 'drizzle-orm';
import { generateRandomCode, hashPassword } from '../../utils/auth.js';
import { sendSMS } from '../../services/smsService.js';

const app = new Hono();

// Send SMS verification code
app.post('/send-reset-sms', async (c) => {
  try {
    const { phone } = await c.req.json();

    if (!phone) {
      return c.json({ error: 'Phone number is required' }, 400);
    }

    // Check if user exists with this phone number
    const user = await db.query.users.findFirst({
      where: eq(users.contact_phone, phone),
      with: {
        authentication: true
      }
    });

    if (!user) {
      return c.json({ error: 'No account found with this phone number' }, 404);
    }

    // Generate verification code (6 digits)
    const verificationCode = generateRandomCode(6);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Store verification code in database
    await db.insert(smsVerificationCodes).values({
      phone,
      code: verificationCode,
      expiresAt,
      used: false
    });

    // Send SMS via QuickSMS
    const message = `Your verification code is: ${verificationCode}. Valid for 10 minutes.`;
    const smsResult = await sendSMS(phone, message);

    if (!smsResult.success) {
      return c.json({ error: 'Failed to send SMS' }, 500);
    }

    return c.json({ 
      success: true, 
      message: 'Verification code sent successfully' 
    });

  } catch (error) {
    console.error('Send SMS error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// Verify SMS code
app.post('/verify-sms-code', async (c) => {
  try {
    const { phone, code } = await c.req.json();

    if (!phone || !code) {
      return c.json({ error: 'Phone and code are required' }, 400);
    }

    // Find valid verification code
    const verificationCode = await db.query.smsVerificationCodes.findFirst({
      where: and(
        eq(smsVerificationCodes.phone, phone),
        eq(smsVerificationCodes.code, code),
        eq(smsVerificationCodes.used, false),
        gt(smsVerificationCodes.expiresAt, new Date())
      )
    });

    if (!verificationCode) {
      return c.json({ error: 'Invalid or expired verification code' }, 400);
    }

    // Mark code as used
    await db.update(smsVerificationCodes)
      .set({ used: true })
      .where(eq(smsVerificationCodes.id, verificationCode.id));

    // Generate password reset token
    const resetToken = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

    // Find user by phone
    const user = await db.query.users.findFirst({
      where: eq(users.contact_phone, phone)
    });

    if (!user) {
      return c.json({ error: 'User not found' }, 404);
    }

    // Store reset token
    await db.insert(passwordResetTokens).values({
      userId: user.id,
      token: resetToken,
      expiresAt,
      used: false
    });

    return c.json({ 
      success: true, 
      resetToken,
      message: 'Code verified successfully' 
    });

  } catch (error) {
    console.error('Verify code error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// Reset password with token
app.post('/reset-password', async (c) => {
  try {
    const { resetToken, newPassword } = await c.req.json();

    if (!resetToken || !newPassword) {
      return c.json({ error: 'Reset token and new password are required' }, 400);
    }

    // Find valid reset token
    const resetTokenRecord = await db.query.passwordResetTokens.findFirst({
      where: and(
        eq(passwordResetTokens.token, resetToken),
        eq(passwordResetTokens.used, false),
        gt(passwordResetTokens.expiresAt, new Date())
      ),
      with: {
        user: true
      }
    });

    if (!resetTokenRecord) {
      return c.json({ error: 'Invalid or expired reset token' }, 400);
    }

    // Mark token as used
    await db.update(passwordResetTokens)
      .set({ used: true })
      .where(eq(passwordResetTokens.id, resetTokenRecord.id));

    // Hash new password
    const hashedPassword = await hashPassword(newPassword);

    // Update user password
    await db.update(Authentication)
      .set({ password: hashedPassword })
      .where(eq(Authentication.user_id, resetTokenRecord.userId));

    return c.json({ 
      success: true, 
      message: 'Password reset successfully' 
    });

  } catch (error) {
    console.error('Reset password error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

export default app;