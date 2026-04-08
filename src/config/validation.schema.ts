import * as Joi from 'joi';

export const validationSchema = Joi.object({
  // Database
  DATABASE_URL: Joi.string().required(),

  // Redis
  UPSTASH_REDIS_URL: Joi.string().required(),

  // Session
  SESSION_SECRET: Joi.string().min(32).required(),

  // OpenRouteService
  ORS_API_KEY: Joi.string().required(),

  // OpenRouter
  OPENROUTER_API_KEY: Joi.string().required(),
  OPENROUTER_DEFAULT_MODEL: Joi.string().default(
    'mistralai/mistral-7b-instruct:free',
  ),

  // Resend
  RESEND_API_KEY: Joi.string().required(),
  RESEND_IMPORT_EMAIL: Joi.string().default('import@notaryday.app'),

  // Lemon Squeezy
  LEMONSQUEEZY_API_KEY: Joi.string().allow('').default(''),
  LEMONSQUEEZY_STORE_ID: Joi.string().allow('').default(''),
  LEMONSQUEEZY_WEBHOOK_SECRET: Joi.string().allow('').default(''),
  LEMONSQUEEZY_PRO_MONTHLY_VARIANT_ID: Joi.string().allow('').default(''),
  LEMONSQUEEZY_PRO_ANNUAL_VARIANT_ID: Joi.string().allow('').default(''),

  // Google Calendar
  GOOGLE_CLIENT_ID: Joi.string().allow('').default(''),
  GOOGLE_CLIENT_SECRET: Joi.string().allow('').default(''),

  // Cloudflare R2
  R2_ACCOUNT_ID: Joi.string().allow('').default(''),
  R2_ACCESS_KEY_ID: Joi.string().allow('').default(''),
  R2_SECRET_ACCESS_KEY: Joi.string().allow('').default(''),
  R2_BUCKET_NAME: Joi.string().default('notaryday-uploads'),

  // App
  APP_URL: Joi.string().default('http://localhost:4000'),
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'staging')
    .default('development'),
  PORT: Joi.number().default(4000),

  // Rate limiting
  THROTTLER_TTL: Joi.number().default(60000),
  THROTTLER_LIMIT: Joi.number().default(100),

  // Application Defaults
  IRS_RATE_PER_MILE: Joi.number().default(0.725),
});
