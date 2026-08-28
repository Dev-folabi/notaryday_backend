import { FieldResult } from '../extraction/extraction.types';
import { SigningType } from '../../../../generated/prisma';

const SIGNING_TYPE_VALUES = [
  SigningType.GENERAL,
  SigningType.LOAN_REFI,
  SigningType.HYBRID,
  SigningType.PURCHASE_CLOSING,
  SigningType.FIELD_INSPECTION,
  SigningType.APOSTILLE,
];

const KEYWORDS: Array<{ type: SigningType; patterns: string[] }> = [
  {
    type: SigningType.LOAN_REFI,
    patterns: [
      'loan refinance',
      'loan refi',
      'refinance',
      'refinancing',
      'refi ',
      'loan signing',
      'refinance signing',
    ],
  },
  {
    type: SigningType.HYBRID,
    patterns: ['hybrid signing', 'hybrid close', 'hybrid'],
  },
  {
    type: SigningType.PURCHASE_CLOSING,
    patterns: [
      'purchase closing',
      'purchase',
      'closing',
      'settlement',
      'home purchase',
      'purchase & closing',
      'purchase and closing',
    ],
  },
  {
    type: SigningType.FIELD_INSPECTION,
    patterns: ['field inspection', 'inspection', 'field assignment'],
  },
  {
    type: SigningType.APOSTILLE,
    patterns: ['apostille'],
  },
];

export function parseSigningType(text: string): FieldResult<SigningType> {
  const normalized = text.toLowerCase().replace(/[_\-\n]/g, ' ');

  // Direct enum value present (e.g. from OCR of an existing label)
  for (const value of SIGNING_TYPE_VALUES) {
    const token = value.replace(/_/g, ' ').toLowerCase();
    if (normalized.includes(token)) {
      return { value, confidence: 0.95 };
    }
  }

  for (const { type, patterns } of KEYWORDS) {
    for (const pattern of patterns) {
      if (normalized.includes(pattern)) {
        return { value: type, confidence: 0.9 };
      }
    }
  }

  return { value: null, confidence: 0 };
}

/** Map a free-form AI value (lowercase, abbreviations) to the Prisma enum. */
export function normalizeSigningType(value: unknown): SigningType | null {
  if (value == null) return null;
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const upper = raw.toUpperCase().replace(/[\s-]+/g, '_');
  if (SIGNING_TYPE_VALUES.includes(upper as SigningType)) {
    return upper as SigningType;
  }
  // Abbreviation / alias map for AI output
  const aliases: Record<string, SigningType> = {
    LOAN: SigningType.LOAN_REFI,
    REFI: SigningType.LOAN_REFI,
    REFINANCE: SigningType.LOAN_REFI,
    LOAN_REFINANCE: SigningType.LOAN_REFI,
    PURCHASE: SigningType.PURCHASE_CLOSING,
    CLOSING: SigningType.PURCHASE_CLOSING,
    GENERAL_SIGNING: SigningType.GENERAL,
    INSPECTION: SigningType.FIELD_INSPECTION,
  };
  return aliases[upper] ?? null;
}
