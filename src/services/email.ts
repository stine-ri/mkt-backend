// services/emailService.ts (create this file)
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export const sendVerificationEmail = async (email: string, code: string, phone: string) => {
  try {
    const { data, error } = await resend.emails.send({
      from: 'Auth System <onboarding@resend.dev>',
      to: email,
      subject: 'Your Verification Code',
      html: `
        <h2>Your Verification Code</h2>
        <p>You requested a password reset for phone number: ${phone}</p>
        <p style="font-size: 24px; font-weight: bold; color: #2563eb;">${code}</p>
        <p>This code is valid for 10 minutes.</p>
        <p>If you didn't request this, please ignore this email.</p>
      `
    });

    if (error) {
      console.error('Email sending error:', error);
      return false;
    }

    console.log('Email sent successfully:', data);
    return true;
  } catch (error) {
    console.error('Email service error:', error);
    return false;
  }
};