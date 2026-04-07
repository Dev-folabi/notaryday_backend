import { registerAs } from '@nestjs/config';

export const databaseConfig = registerAs('database', () => ({
  url: process.env.DATABASE_URL!,
}));

export const redisConfig = registerAs('redis', () => ({
  url: process.env.UPSTASH_REDIS_URL!,
}));

export const sessionConfig = registerAs('session', () => ({
  secret: process.env.SESSION_SECRET!,
  cookieMaxAge: 24 * 60 * 60 * 1000, // 24 hours
  cookieRememberMaxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
}));

export const appConfig = registerAs('app', () => ({
  url: process.env.APP_URL ?? 'http://localhost:4000',
  port: parseInt(process.env.PORT ?? '4000', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
}));

export const orsConfig = registerAs('ors', () => ({
  apiKey: process.env.ORS_API_KEY!,
  baseUrl: 'https://api.openrouteservice.org/v2',
}));

export const openRouterConfig = registerAs('openrouter', () => ({
  apiKey: process.env.OPENROUTER_API_KEY!,
  baseUrl: 'https://openrouter.ai/api/v1',
  defaultModel:
    process.env.OPENROUTER_DEFAULT_MODEL ??
    'mistralai/mistral-7b-instruct:free',
}));

export const resendConfig = registerAs('resend', () => ({
  apiKey: process.env.RESEND_API_KEY!,
  importEmail: process.env.RESEND_IMPORT_EMAIL ?? 'import@notaryday.app',
}));

export const lemonSqueezyConfig = registerAs('lemonsqueezy', () => ({
  apiKey: process.env.LEMONSQUEEZY_API_KEY ?? '',
  storeId: process.env.LEMONSQUEEZY_STORE_ID ?? '',
  webhookSecret: process.env.LEMONSQUEEZY_WEBHOOK_SECRET ?? '',
  proMonthlyVariantId: process.env.LEMONSQUEEZY_PRO_MONTHLY_VARIANT_ID ?? '',
  proAnnualVariantId: process.env.LEMONSQUEEZY_PRO_ANNUAL_VARIANT_ID ?? '',
}));

export const googleConfig = registerAs('google', () => ({
  clientId: process.env.GOOGLE_CLIENT_ID ?? '',
  clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
}));

export const r2Config = registerAs('r2', () => ({
  accountId: process.env.R2_ACCOUNT_ID ?? '',
  accessKeyId: process.env.R2_ACCESS_KEY_ID ?? '',
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? '',
  bucketName: process.env.R2_BUCKET_NAME ?? 'notaryday-uploads',
}));

export default [
  databaseConfig,
  redisConfig,
  sessionConfig,
  appConfig,
  orsConfig,
  openRouterConfig,
  resendConfig,
  lemonSqueezyConfig,
  googleConfig,
  r2Config,
];
