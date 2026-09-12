import { IMPORT_TARGET_FIELDS, ProviderType } from '../marketing.constants';

/**
 * Field normalization for imported lead rows: maps raw spreadsheet values to
 * canonical enum values and parses the "Subject: X\n\nBody" email cell format.
 * Used by both the API (suggestion) and the marketing worker (ingest).
 */

const HEADER_ALIASES: Record<string, string[]> = {
  leadId: ['lead id', 'leadid', 'id', 'prospect id'],
  fitTier: ['fit tier', 'fittier', 'tier', 'fit'],
  prospectScore: ['prospect score', 'score', 'prospectscore'],
  businessName: ['business name', 'business', 'company', 'company name'],
  professionalName: [
    'public professional name',
    'professional name',
    'contact name',
    'name',
  ],
  website: ['website', 'url', 'web'],
  email: [
    'public professional email',
    'email',
    'email address',
    'public email',
  ],
  emailVerification: ['email verification', 'verification', 'email status'],
  phone: ['phone', 'phone number', 'mobile'],
  facebookUrl: ['facebook url', 'facebook', 'fb'],
  instagramUrl: ['instagram url', 'instagram', 'ig'],
  address: ['address', 'street', 'street address'],
  city: ['city', 'town'],
  state: ['state', 'region', 'province'],
  qualificationEvidence: ['qualification evidence', 'evidence', 'signals'],
  bestAngle: ['best notary day angle', 'best angle', 'angle'],
  personalizationHook: ['personalization hook', 'hook', 'personalization'],
  recommendedChannel: ['recommended channel', 'channel'],
  emailSubject: ['email subject', 'subject'],
  verificationStatus: ['verification status'],
  excludeFromSend: ['exclude from send', 'exclude', 'do not send'],
  campaignWave: ['campaign wave', 'wave'],
  abGroup: ['ab test group', 'ab group', 'ab', 'variant'],
  dmMessage: ['dm message', 'dm', 'direct message'],
};

function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Suggests a mapping of target field -> column index from sheet headers. */
export function suggestMapping(headers: string[]): Record<string, number> {
  const mapping: Record<string, number> = {};
  const normalized = headers.map(normalizeHeader);

  normalized.forEach((header, idx) => {
    // email sequence columns: "Email 1 (Day 1)" etc.
    const emailMatch = header.match(/^email\s*(\d+)/);
    if (emailMatch) {
      const n = Number(emailMatch[1]);
      if (n >= 1 && n <= 9) {
        mapping[`email${n}`] = idx;
        return;
      }
    }
    for (const [target, aliases] of Object.entries(HEADER_ALIASES)) {
      if (aliases.includes(header) && mapping[target] === undefined) {
        mapping[target] = idx;
        return;
      }
    }
  });

  return mapping;
}

const EMAIL_SUBJECT_RE = /^subject\s*:\s*([^\n\r]*)/i;

export interface ParsedSequenceEmail {
  subject: string;
  body: string;
}

/** Splits "Subject: X\n\nBody" cells into subject + body. */
export function parseSequenceEmailCell(
  cell: string | undefined,
): ParsedSequenceEmail {
  const raw = (cell ?? '').trim();
  if (!raw) return { subject: '', body: '' };
  const subjectMatch = raw.match(EMAIL_SUBJECT_RE);
  if (subjectMatch) {
    const subject = subjectMatch[1].trim();
    const rest = raw.slice(subjectMatch[0].length).trim();
    return { subject, body: rest };
  }
  return { subject: '', body: raw };
}

/** "A+ - Highest-intent LSA" -> "A_PLUS"; raw kept separately. */
export function mapFitTier(raw: string | undefined): string | null {
  const value = (raw ?? '').trim().toUpperCase();
  if (!value) return null;
  if (value.startsWith('A+')) return 'A_PLUS';
  if (value.startsWith('A')) return 'A';
  if (value.startsWith('B')) return 'B';
  if (value.startsWith('C')) return 'C';
  return null;
}

/** "Wave 1 (Weeks 1-2)" -> "WAVE_1"; "Parallel: Social/Phone track" -> "SOCIAL_PHONE". */
export function mapWaveKey(raw: string | undefined): string | null {
  const value = (raw ?? '').trim().toLowerCase();
  if (!value) return null;
  const waveMatch = value.match(/wave\s*(\d)/);
  if (waveMatch) {
    const n = Number(waveMatch[1]);
    if (n >= 1 && n <= 3) return `WAVE_${n}`;
    return null;
  }
  if (value.includes('social') || value.includes('phone'))
    return 'SOCIAL_PHONE';
  if (value.includes('exclud')) return 'EXCLUDED';
  return null;
}

/** "Y"/"N"/"yes"/"true" -> boolean */
export function mapBoolean(raw: string | undefined): boolean {
  const value = (raw ?? '').trim().toLowerCase();
  return value === 'y' || value === 'yes' || value === 'true' || value === '1';
}

/** "A"/"B" (AB test group) -> "A" | "B" | null */
export function mapAbGroup(raw: string | undefined): string | null {
  const value = (raw ?? '').trim().toUpperCase();
  if (value === 'A' || value === 'B') return value;
  return null;
}

/** "Email 5 (Day 9)" header -> day offset 9 (fallback: 2*step-1). */
export function dayOffsetFromHeader(
  header: string | undefined,
  step: number,
): number {
  const match = (header ?? '').match(/day\s*(\d+)/i);
  if (match) return Number(match[1]);
  return step * 2 - 1;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string | undefined): boolean {
  return !!email && EMAIL_RE.test(email.trim().toLowerCase());
}

export function sanitizeEmail(raw: string | undefined): string | null {
  let value = (raw ?? '').trim();
  if (!value) return null;
  // Source data sometimes contains URL-encoded whitespace (%20) in emails
  if (value.includes('%')) {
    try {
      const decoded = decodeURIComponent(value).trim();
      if (EMAIL_RE.test(decoded)) value = decoded;
    } catch {
      // keep original
    }
  }
  value = value.toLowerCase();
  return EMAIL_RE.test(value) ? value : null;
}

export const SMTP_DEFAULTS: Record<string, { host: string; port: number }> = {
  zoho: { host: 'smtp.zoho.com', port: 587 },
  gmail: { host: 'smtp.gmail.com', port: 465 },
};

export function providerTypeLabel(type: ProviderType): string {
  switch (type) {
    case 'resend':
      return 'Resend (API)';
    case 'brevo':
      return 'Brevo (API)';
    case 'zoho':
      return 'Zoho Mail (SMTP)';
    case 'gmail':
      return 'Gmail (SMTP)';
    default:
      return type;
  }
}

export const ALL_TARGET_FIELDS: readonly string[] = IMPORT_TARGET_FIELDS;
