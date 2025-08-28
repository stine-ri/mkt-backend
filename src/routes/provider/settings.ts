import { Hono } from 'hono';
import { verify } from 'hono/jwt';
import { validator } from 'hono/validator';
import { z } from 'zod';
import nodemailer from 'nodemailer';
import crypto from 'crypto';
import { db } from '../../drizzle/db.js';
import { users, settings } from '../../drizzle/schema.js';
import { eq, and } from 'drizzle-orm';
import type { Context, Next } from 'hono';

// Define your Variables type
type Variables = {
  user: {
    id: number;
    email: string;
    role: string;
  };
};

// Extend Hono's Context instead of creating a custom one
type CustomContext = Context<{
  Variables: Variables;
}>;

const app = new Hono<{ Variables: Variables }>();

// Encryption helper functions
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex');

function encrypt(text: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return iv.toString('hex') + ':' + authTag + ':' + encrypted;
}

function decrypt(text: string): string {
  const textParts = text.split(':');
  const iv = Buffer.from(textParts.shift()!, 'hex');
  const authTag = Buffer.from(textParts.shift()!, 'hex');
  const encryptedText = textParts.join(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// Settings service class
class SettingsService {
  async getSetting(category: string, key: string = 'config') {
    try {
      const setting = await db
        .select()
        .from(settings)
        .where(and(eq(settings.category, category), eq(settings.key, key)))
        .limit(1);

      if (!setting.length) {
        return this.getDefaultSettings(category);
      }

      const settingData = setting[0];
      let value = settingData.value as any;

      // Decrypt sensitive fields if necessary
      if (settingData.isEncrypted && value) {
        value = this.decryptSensitiveFields(category, value);
      }

      return value;
    } catch (error) {
      console.error(`Error getting setting ${category}:${key}:`, error);
      return this.getDefaultSettings(category);
    }
  }

  async updateSetting(category: string, value: any, key: string = 'config') {
    try {
      // Encrypt sensitive fields
      const processedValue = this.encryptSensitiveFields(category, value);
      const isEncrypted = this.hasSensitiveFields(category);

      const existingSetting = await db
        .select()
        .from(settings)
        .where(and(eq(settings.category, category), eq(settings.key, key)))
        .limit(1);

      if (existingSetting.length) {
        await db
          .update(settings)
          .set({
            value: processedValue,
            isEncrypted,
            updatedAt: new Date(),
          })
          .where(and(eq(settings.category, category), eq(settings.key, key)));
      } else {
        await db.insert(settings).values({
          category,
          key,
          value: processedValue,
          isEncrypted,
          description: `${category} configuration`,
        });
      }

      return true;
    } catch (error) {
      console.error(`Error updating setting ${category}:${key}:`, error);
      throw error;
    }
  }

  private encryptSensitiveFields(category: string, value: any): any {
    const sensitiveFields = this.getSensitiveFields(category);
    if (!sensitiveFields.length) return value;

    const processedValue = { ...value };
    for (const field of sensitiveFields) {
      if (processedValue[field] && processedValue[field] !== '••••••••') {
        processedValue[field] = encrypt(processedValue[field]);
      }
    }
    return processedValue;
  }

  private decryptSensitiveFields(category: string, value: any): any {
    const sensitiveFields = this.getSensitiveFields(category);
    if (!sensitiveFields.length) return value;

    const processedValue = { ...value };
    for (const field of sensitiveFields) {
      if (processedValue[field]) {
        try {
          processedValue[field] = decrypt(processedValue[field]);
        } catch (error) {
          console.error(`Error decrypting field ${field}:`, error);
          processedValue[field] = '';
        }
      }
    }
    return processedValue;
  }

  private getSensitiveFields(category: string): string[] {
    const sensitiveFieldsMap: Record<string, string[]> = {
      email: ['smtpPassword'],
      security: ['recaptchaSecretKey'],
    };
    return sensitiveFieldsMap[category] || [];
  }

  private hasSensitiveFields(category: string): boolean {
    return this.getSensitiveFields(category).length > 0;
  }

  private getDefaultSettings(category: string): any {
    const defaults: Record<string, any> = {
      email: {
        smtpHost: '',
        smtpPort: 587,
        smtpUser: '',
        smtpPassword: '',
        fromEmail: '',
        fromName: 'Marketplace',
        enableEmailNotifications: true,
        enableWelcomeEmails: true,
        enableOrderEmails: true,
      },
      security: {
        maxLoginAttempts: 5,
        sessionTimeout: 30,
        requireEmailVerification: true,
        enableTwoFactor: false,
        passwordMinLength: 8,
        requireSpecialChars: true,
        enableRecaptcha: false,
        recaptchaSiteKey: '',
        recaptchaSecretKey: '',
      },
      system: {
        siteName: 'Marketplace',
        siteDescription: 'A modern marketplace platform',
        siteUrl: '',
        maintenanceMode: false,
        maintenanceMessage: 'We are currently performing maintenance. Please check back soon.',
        enableRegistration: true,
        enableGuestCheckout: true,
        defaultCurrency: 'USD',
        defaultLanguage: 'en',
        timezone: 'UTC',
        enableAnalytics: false,
        googleAnalyticsId: '',
      },
      notifications: {
        emailNotifications: true,
        pushNotifications: true,
        smsNotifications: false,
        adminAlerts: true,
        userActivityAlerts: true,
        systemAlerts: true,
        marketingEmails: false,
        newsletterEnabled: true,
      },
    };
    return defaults[category] || {};
  }
}

const settingsService = new SettingsService();

// Middleware for admin authentication
const adminAuth = async (c: CustomContext, next: Next) => {
  try {
    const authHeader = c.req.header('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const token = authHeader.substring(7);
    const payload = await verify(token, process.env.JWT_SECRET!);
    
    const user = await db.select().from(users).where(eq(users.id, (payload as any).userId)).limit(1);
    
    if (!user.length || user[0].role !== 'admin') {
      return c.json({ error: 'Admin access required' }, 403);
    }

    c.set('user', user[0]);
    await next();
  } catch (error) {
    return c.json({ error: 'Invalid token' }, 401);
  }
};

// Apply admin auth middleware to all routes
app.use('*', adminAuth);

// Validation schemas 
const emailSettingsSchema = z.object({
  smtpHost: z.string().min(1, 'SMTP host is required'),
  smtpPort: z.number().min(1).max(65535, 'Invalid port number'),
  smtpUser: z.string().min(1, 'SMTP user is required'),
  smtpPassword: z.string().min(1, 'SMTP password is required'),
  fromEmail: z.string().email('Invalid email format'),
  fromName: z.string().min(1, 'From name is required'),
  enableEmailNotifications: z.boolean(),
  enableWelcomeEmails: z.boolean(),
  enableOrderEmails: z.boolean(),
});

const securitySettingsSchema = z.object({
  maxLoginAttempts: z.number().min(1).max(10),
  sessionTimeout: z.number().min(5).max(1440),
  requireEmailVerification: z.boolean(),
  enableTwoFactor: z.boolean(),
  passwordMinLength: z.number().min(6).max(32),
  requireSpecialChars: z.boolean(),
  enableRecaptcha: z.boolean(),
  recaptchaSiteKey: z.string().optional(),
  recaptchaSecretKey: z.string().optional(),
});

const systemSettingsSchema = z.object({
  siteName: z.string().min(1),
  siteDescription: z.string().min(1),
  siteUrl: z.string().url().optional().or(z.literal('')),
  maintenanceMode: z.boolean(),
  maintenanceMessage: z.string().optional(),
  enableRegistration: z.boolean(),
  enableGuestCheckout: z.boolean(),
  defaultCurrency: z.enum(['USD', 'EUR', 'GBP', 'KES']),
  defaultLanguage: z.enum(['en', 'es', 'fr', 'sw']),
  timezone: z.enum(['UTC', 'America/New_York', 'Europe/London', 'Africa/Nairobi']),
  enableAnalytics: z.boolean(),
  googleAnalyticsId: z.string().optional(),
});

const notificationSettingsSchema = z.object({
  emailNotifications: z.boolean(),
  pushNotifications: z.boolean(),
  smsNotifications: z.boolean(),
  adminAlerts: z.boolean(),
  userActivityAlerts: z.boolean(),
  systemAlerts: z.boolean(),
  marketingEmails: z.boolean(),
  newsletterEnabled: z.boolean(),
});

// Email Settings Routes
app.get('/email', async (c) => {
  try {
    const emailSettings = await settingsService.getSetting('email');
    
    // Mask password in response
    const response = { 
      ...emailSettings, 
      smtpPassword: emailSettings.smtpPassword ? '••••••••' : '' 
    };
    
    return c.json(response);
  } catch (error) {
    console.error('Error fetching email settings:', error);
    return c.json({ error: 'Failed to fetch email settings' }, 500);
  }
});

app.put('/email', 
  validator('json', (value, c) => {
    const parsed = emailSettingsSchema.safeParse(value);
    if (!parsed.success) {
      return c.json({ error: 'Invalid input', details: parsed.error.issues }, 400);
    }
    return parsed.data;
  }),
  async (c) => {
    try {
      const data = c.req.valid('json');
      
      if (data.smtpPassword === '••••••••') {
        const existingSettings = await settingsService.getSetting('email');
        data.smtpPassword = existingSettings.smtpPassword;
      }
      
      if (data.smtpHost && data.smtpUser && data.smtpPassword) {
        try {
          const transporter = nodemailer.createTransport({
            host: data.smtpHost,
            port: data.smtpPort,
            secure: data.smtpPort === 465,
            auth: {
              user: data.smtpUser,
              pass: data.smtpPassword,
            },
          });
          
          await transporter.verify();
        } catch (error) {
          return c.json({ error: 'Invalid SMTP configuration' }, 400);
        }
      }
      
      await settingsService.updateSetting('email', data);
      return c.json({ message: 'Email settings updated successfully' });
    } catch (error) {
      console.error('Error updating email settings:', error);
      return c.json({ error: 'Failed to update email settings' }, 500);
    }
  }
);

// Test email endpoint
app.post('/email/test', async (c: CustomContext) => {
  try {
    const settings = await settingsService.getSetting('email');
    
    if (!settings.smtpHost || !settings.smtpUser || !settings.smtpPassword) {
      return c.json({ error: 'Email configuration incomplete' }, 400);
    }
    
    const transporter = nodemailer.createTransport({
      host: settings.smtpHost,
      port: settings.smtpPort,
      secure: settings.smtpPort === 465,
      auth: {
        user: settings.smtpUser,
        pass: settings.smtpPassword,
      },
    });
    
    const user = c.get('user');
    
    await transporter.sendMail({
      from: `${settings.fromName} <${settings.fromEmail}>`,
      to: user.email,
      subject: 'Test Email - Settings Configuration',
      html: `
        <h2>Email Configuration Test</h2>
        <p>This is a test email to verify your SMTP settings are working correctly.</p>
        <p>Sent at: ${new Date().toISOString()}</p>
        <p>From: ${settings.fromName}</p>
      `,
    });
    
    return c.json({ message: 'Test email sent successfully' });
  } catch (error) {
    console.error('Error sending test email:', error);
    return c.json({ error: 'Failed to send test email' }, 500);
  }
});

// Security Settings Routes
app.get('/security', async (c) => {
  try {
    const securitySettings = await settingsService.getSetting('security');
    
    // Mask secret key in response
    const response = { 
      ...securitySettings, 
      recaptchaSecretKey: securitySettings.recaptchaSecretKey ? '••••••••' : '' 
    };
    
    return c.json(response);
  } catch (error) {
    console.error('Error fetching security settings:', error);
    return c.json({ error: 'Failed to fetch security settings' }, 500);
  }
});

app.put('/security',
  validator('json', (value, c) => {
    const parsed = securitySettingsSchema.safeParse(value);
    if (!parsed.success) {
      return c.json({ error: 'Invalid input', details: parsed.error.issues }, 400);
    }
    return parsed.data;
  }),
  async (c) => {
    try {
      const data = c.req.valid('json');
      
      // If secret key is masked, preserve existing key
      if (data.recaptchaSecretKey === '••••••••') {
        const existingSettings = await settingsService.getSetting('security');
        data.recaptchaSecretKey = existingSettings.recaptchaSecretKey;
      }
      
      // Validate reCAPTCHA keys if enabled
      if (data.enableRecaptcha && (!data.recaptchaSiteKey || !data.recaptchaSecretKey)) {
        return c.json({ error: 'reCAPTCHA keys are required when reCAPTCHA is enabled' }, 400);
      }
      
      await settingsService.updateSetting('security', data);
      
      return c.json({ message: 'Security settings updated successfully' });
    } catch (error) {
      console.error('Error updating security settings:', error);
      return c.json({ error: 'Failed to update security settings' }, 500);
    }
  }
);

// System Settings Routes
app.get('/system', async (c) => {
  try {
    const systemSettings = await settingsService.getSetting('system');
    return c.json(systemSettings);
  } catch (error) {
    console.error('Error fetching system settings:', error);
    return c.json({ error: 'Failed to fetch system settings' }, 500);
  }
});

app.put('/system',
  validator('json', (value, c) => {
    const parsed = systemSettingsSchema.safeParse(value);
    if (!parsed.success) {
      return c.json({ error: 'Invalid input', details: parsed.error.issues }, 400);
    }
    return parsed.data;
  }),
  async (c) => {
    try {
      const data = c.req.valid('json');
      
      // Validate Google Analytics ID format if analytics is enabled
      if (data.enableAnalytics && data.googleAnalyticsId) {
        const gaIdPattern = /^(GA|G)-[A-Z0-9-]+$/;
        if (!gaIdPattern.test(data.googleAnalyticsId)) {
          return c.json({ error: 'Invalid Google Analytics ID format' }, 400);
        }
      }
      
      await settingsService.updateSetting('system', data);
      
      return c.json({ message: 'System settings updated successfully' });
    } catch (error) {
      console.error('Error updating system settings:', error);
      return c.json({ error: 'Failed to update system settings' }, 500);
    }
  }
);

// Notification Settings Routes
app.get('/notifications', async (c) => {
  try {
    const notificationSettings = await settingsService.getSetting('notifications');
    return c.json(notificationSettings);
  } catch (error) {
    console.error('Error fetching notification settings:', error);
    return c.json({ error: 'Failed to fetch notification settings' }, 500);
  }
});

app.put('/notifications',
  validator('json', (value, c) => {
    const parsed = notificationSettingsSchema.safeParse(value);
    if (!parsed.success) {
      return c.json({ error: 'Invalid input', details: parsed.error.issues }, 400);
    }
    return parsed.data;
  }),
  async (c) => {
    try {
      const data = c.req.valid('json');
      await settingsService.updateSetting('notifications', data);
      
      return c.json({ message: 'Notification settings updated successfully' });
    } catch (error) {
      console.error('Error updating notification settings:', error);
      return c.json({ error: 'Failed to update notification settings' }, 500);
    }
  }
);

// Backup endpoint
app.post('/backup', async (c: CustomContext) => {
  try {
    const timestamp = new Date().toISOString();
    
    const [emailSettings, securitySettings, systemSettings, notificationSettings] = await Promise.all([
      settingsService.getSetting('email'),
      settingsService.getSetting('security'),
      settingsService.getSetting('system'),
      settingsService.getSetting('notifications'),
    ]);
    
    const user = c.get('user');
    
    const backupData = {
      timestamp,
      version: '1.0',
      settings: {
        email: emailSettings,
        security: securitySettings,
        system: systemSettings,
        notifications: notificationSettings,
      },
      metadata: {
        generatedBy: user.email,
        description: 'System settings backup',
      },
    };
    
    const backupContent = JSON.stringify(backupData, null, 2);
    
    c.header('Content-Type', 'application/json');
    c.header('Content-Disposition', `attachment; filename="settings-backup-${timestamp.slice(0, 10)}.json"`);
    
    return c.text(backupContent); // Use c.text instead of c.body
  } catch (error) {
    console.error('Error creating backup:', error);
    return c.json({ error: 'Failed to create backup' }, 500);
  }
});

// Restore backup endpoint
app.post('/backup/restore', 
  validator('json', (value, c) => {
    const schema = z.object({
      settings: z.object({
        email: z.any().optional(),
        security: z.any().optional(),
        system: z.any().optional(),
        notifications: z.any().optional(),
      }),
    });
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      return c.json({ error: 'Invalid backup format' }, 400);
    }
    return parsed.data;
  }),
  async (c) => {
    try {
      const backupData = c.req.valid('json');
      const user = c.get('user');
      
      const promises = [];
      
      // Restore each category of settings
      if (backupData.settings.email) {
        promises.push(settingsService.updateSetting('email', backupData.settings.email));
      }
      if (backupData.settings.security) {
        promises.push(settingsService.updateSetting('security', backupData.settings.security));
      }
      if (backupData.settings.system) {
        promises.push(settingsService.updateSetting('system', backupData.settings.system));
      }
      if (backupData.settings.notifications) {
        promises.push(settingsService.updateSetting('notifications', backupData.settings.notifications));
      }
      
      await Promise.all(promises);
      
      console.log(`Settings restored by admin: ${user.email} at ${new Date().toISOString()}`);
      
      return c.json({ message: 'Settings restored successfully' });
    } catch (error) {
      console.error('Error restoring backup:', error);
      return c.json({ error: 'Failed to restore backup' }, 500);
    }
  }
);

// Cache clear endpoint
app.post('/cache/clear', async (c) => {
  try {
    const user = c.get('user');
    
    console.log(`Cache cleared by admin: ${user.email} at ${new Date().toISOString()}`);
    
    return c.json({ message: 'Cache cleared successfully' });
  } catch (error) {
    console.error('Error clearing cache:', error);
    return c.json({ error: 'Failed to clear cache' }, 500);
  }
});

// System health check
app.get('/health', async (c) => {
  try {
    // Check database connection
    const dbTest = await db.select().from(settings).limit(1);
    
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: 'connected',
      uptime: process.uptime(),
      memory: process.memoryUsage(),
    };
    
    return c.json(health);
  } catch (error) {
    console.error('Health check failed:', error);
    return c.json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: 'Database connection failed'
    }, 500);
  }
});

export default app;