import { FieldResult } from '../extraction/extraction.types';

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;

const PHONE_RE = /(\+?1[\s.-]?)?(\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}/;

export function parsePhone(text: string): FieldResult<string> {
  const match = text.match(PHONE_RE);
  if (!match) return { value: null, confidence: 0 };
  const digits = match[0].replace(/[^\d]/g, '');
  if (digits.length < 10) return { value: null, confidence: 0 };
  const normalized =
    digits.length === 11 && digits[0] === '1' ? `+${digits}` : `+1${digits}`;
  return { value: normalized, confidence: 0.9 };
}

export function parseEmail(text: string): FieldResult<string> {
  const match = text.match(EMAIL_RE);
  if (!match) return { value: null, confidence: 0 };
  return { value: match[0].toLowerCase(), confidence: 0.95 };
}
