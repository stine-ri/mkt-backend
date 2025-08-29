// routes/auth/sms-reset.ts
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
import { sendSMS, sendMockSMS } from '../../services/smsService.js';
import { logVerificationCode } from '../../services/verificationService.js';

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
      where: eq(users.contact_phone, phone)
    });

    // Always return success for security, even if user doesn't exist
    const responseMessage = 'If this phone number is registered, a verification code will be sent';

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

    // Log to console for debugging
    logVerificationCode(phone, verificationCode, expiresAt);

    // Try to send SMS (use mock in development)
    let smsResult;
    if (process.env.NODE_ENV === 'production') {
      const message = `Your verification code is: ${verificationCode}. Valid for 10 minutes.`;
      smsResult = await sendSMS(phone, message);
    } else {
      // Use mock in development
      const message = `[DEV] Your code: ${verificationCode}. Valid for 10 minutes.`;
      smsResult = await sendMockSMS(phone, message);
    }

    // Prepare response
    const response: any = { 
      success: true, 
      message: responseMessage
    };

    // Include debug info in development
    if (process.env.NODE_ENV !== 'production') {
      response.debug = {
        code: verificationCode,
        expiresAt: expiresAt.toISOString(),
        smsSuccess: smsResult.success,
        smsError: smsResult.error,
        viewCodes: `${new URL(c.req.url).origin}/api/debug/codes`
      };
    }

    return c.json(response);

  } catch (error) {
    console.error('Send SMS error:', error);
    // Always return success for security
    return c.json({ 
      success: true, 
      message: 'If this phone number is registered, a verification code will be sent' 
    });
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


