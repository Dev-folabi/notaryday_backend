// Marketing/CRM enums and constants. Values are stored in MongoDB.

export const LEAD_STATUSES = [
  'NEW',
  'NEEDS_VERIFICATION',
  'IN_SEQUENCE',
  'CONTACTED',
  'REPLIED',
  'CONVERTED',
  'UNSUBSCRIBED',
  'BOUNCED',
  'EXCLUDED',
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const FIT_TIERS = ['A_PLUS', 'A', 'B', 'C'] as const;
export type FitTier = (typeof FIT_TIERS)[number];

export const WAVE_KEYS = [
  'WAVE_1',
  'WAVE_2',
  'WAVE_3',
  'SOCIAL_PHONE',
  'EXCLUDED',
] as const;
export type WaveKey = (typeof WAVE_KEYS)[number];

export const AB_GROUPS = ['A', 'B'] as const;
export type AbGroup = (typeof AB_GROUPS)[number];

export const PROVIDER_TYPES = ['resend', 'brevo', 'zoho', 'gmail'] as const;
export type ProviderType = (typeof PROVIDER_TYPES)[number];

export const PROVIDER_STATUSES = ['ACTIVE', 'PAUSED'] as const;
export type ProviderStatus = (typeof PROVIDER_STATUSES)[number];

export const SUPPRESSION_TYPES = [
  'UNSUBSCRIBE',
  'BOUNCE',
  'COMPLAINT',
  'MANUAL',
] as const;
export type SuppressionType = (typeof SUPPRESSION_TYPES)[number];

export const IMPORT_STATUSES = [
  'UPLOADED',
  'MAPPED',
  'QUEUED',
  'PROCESSING',
  'COMPLETED',
  'COMPLETED_WITH_ERRORS',
  'FAILED',
  'CANCELLED',
] as const;
export type ImportStatus = (typeof IMPORT_STATUSES)[number];

// DM message is stored as step 10 so the 9 email steps stay 1-9.
export const DM_STEP = 10;

// Canonical import target fields. Column mapping maps these -> column index.
export const IMPORT_TARGET_FIELDS = [
  'leadId',
  'fitTier',
  'prospectScore',
  'businessName',
  'professionalName',
  'website',
  'email',
  'emailVerification',
  'phone',
  'facebookUrl',
  'instagramUrl',
  'address',
  'city',
  'state',
  'qualificationEvidence',
  'bestAngle',
  'personalizationHook',
  'recommendedChannel',
  'emailSubject',
  'verificationStatus',
  'excludeFromSend',
  'campaignWave',
  'abGroup',
  'email1',
  'email2',
  'email3',
  'email4',
  'email5',
  'email6',
  'email7',
  'email8',
  'email9',
  'dmMessage',
] as const;
export type ImportTargetField = (typeof IMPORT_TARGET_FIELDS)[number];

// Required credentials per provider type.
export const PROVIDER_CREDENTIAL_KEYS: Record<ProviderType, string[]> = {
  resend: ['apiKey'],
  brevo: ['apiKey'],
  zoho: ['user', 'password'],
  gmail: ['user', 'appPassword'],
};

// ---- Campaigns ----

export const CAMPAIGN_TYPES = ['ONE_OFF', 'SEQUENCE', 'DIRECT'] as const;
export type CampaignType = (typeof CAMPAIGN_TYPES)[number];

export const CAMPAIGN_STATUSES = [
  'DRAFT',
  'SCHEDULED',
  'DISPATCHING',
  'RUNNING',
  'PAUSED',
  'COMPLETED',
  'CANCELLED',
  'FAILED',
] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const AUDIENCE_MODES = ['FILTER', 'IDS', 'USERS'] as const;
export type AudienceMode = (typeof AUDIENCE_MODES)[number];

export const CONTENT_MODES = ['LEAD_DRAFTS', 'TEMPLATE'] as const;
export type ContentMode = (typeof CONTENT_MODES)[number];

export const RECIPIENT_STATUSES = [
  'QUEUED',
  'SENDING',
  'SENT',
  'FAILED',
  'SKIPPED',
  'CANCELLED',
  'BOUNCED',
  'COMPLAINED',
  'UNSUBSCRIBED',
] as const;
export type RecipientStatus = (typeof RECIPIENT_STATUSES)[number];

export const EMAIL_EVENT_TYPES = [
  'SENT',
  'DELIVERED',
  'BOUNCED',
  'COMPLAINED',
  'OPENED',
  'CLICKED',
  'REPLIED',
  'UNSUBSCRIBED',
  'FAILED',
  'SKIPPED',
  'CONVERTED',
] as const;
export type EmailEventType = (typeof EMAIL_EVENT_TYPES)[number];

/** Conversion kinds recorded on CONVERTED events (meta.kind). */
export const CONVERSION_KINDS = ['signup', 'citt', 'pro'] as const;
export type ConversionKind = (typeof CONVERSION_KINDS)[number];

// ---- Waves ----

export const WAVE_STATUSES = ['PLANNED', 'ACTIVE', 'COMPLETED'] as const;
export type WaveStatus = (typeof WAVE_STATUSES)[number];

// ---- Outreach tasks (social/phone track) ----

export const TASK_STATUSES = ['TODO', 'DONE', 'SKIPPED'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_CHANNELS = [
  'Instagram DM',
  'Facebook message',
  'Phone/website',
] as const;
export type TaskChannel = (typeof TASK_CHANNELS)[number];

export const EMAIL_EVENT_SOURCES = [
  'SEND',
  'PIXEL',
  'WEBHOOK',
  'API',
  'CRON',
] as const;

/** Template variables available in TEMPLATE content mode. */
export const TEMPLATE_VARIABLES = [
  'business_name',
  'professional_name',
  'first_name',
  'city',
  'state',
  'website',
  'personalization_hook',
  'best_angle',
  'lead_id',
  'email',
] as const;

// Warmup: start at 20/day, +25/day since warmup started, capped at dailyLimit.
export const WARMUP_BASE_DAILY = 20;
export const WARMUP_DAILY_STEP = 25;
