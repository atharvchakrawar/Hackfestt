require('dotenv').config();

function envValue(name) {
  const value = process.env[name] || '';
  return value.startsWith('PASTE_') ? '' : value;
}

/** @type {import('./index').AppConfig} */
const config = {
  port: parseInt(process.env.PORT || '4000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  jwtSecret: process.env.JWT_SECRET || 'dev_jwt_secret_change_me',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
  databaseUrl: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/college_events',
  google: {
    clientId: envValue('GOOGLE_CLIENT_ID'),
    clientSecret: envValue('GOOGLE_CLIENT_SECRET'),
    callbackUrl: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:4000/api/auth/google/callback',
  },
  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID || '',
    keySecret: process.env.RAZORPAY_KEY_SECRET || '',
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET || '',
    devMode: process.env.PAYMENT_DEV_MODE !== 'false',
  },
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || '',
    apiKey: process.env.CLOUDINARY_API_KEY || '',
    apiSecret: process.env.CLOUDINARY_API_SECRET || '',
    devMode: process.env.STORAGE_DEV_MODE !== 'false',
  },
  email: {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.EMAIL_FROM || 'HackConnect <noreply@hackconnect.in>',
    devMode: process.env.EMAIL_DEV_MODE !== 'false',
  },
  admin: {
    email: process.env.ADMIN_EMAIL || 'admin@collegeevents.in',
    password: process.env.ADMIN_PASSWORD || 'admin123',
  },
};

module.exports = config;


