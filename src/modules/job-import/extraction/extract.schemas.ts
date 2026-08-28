import { z } from 'zod';
import { SigningType } from '../../../../generated/prisma';
import { ParsedImport } from './extraction.types';
import { normalizeSigningType } from '../parsing/signing-type.parser';

/**
 * Zod schema used to validate BOTH rule-parser output and AI-provider output
 * before anything is persisted. Prevents lowercase/AI-invented signing types
 * from crashing the Prisma enum column.
 */
export const ParsedImportSchema = z.object({
  address: z.string().max(500).nullable().optional(),
  appointment_time: z.string().nullable().optional(),
  signing_type: z
    .enum(Object.values(SigningType) as [string, ...string[]])
    .nullable()
    .optional(),
  fee: z.number().min(0).max(100000).nullable().optional(),
  platform_fee: z.number().min(0).max(100000).nullable().optional(),
  client_name: z.string().max(200).nullable().optional(),
  client_phone: z.string().max(30).nullable().optional(),
  client_email: z.string().email().nullable().optional(),
  platform_name: z.string().max(100).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

/**
 * Normalize a free-form extraction result into a validated ParsedImport.
 */
export function normalizeParsedImport(raw: unknown): ParsedImport {
  const source: Record<string, unknown> =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};

  const candidate: ParsedImport = {
    address: cleanString(source.address),
    appointment_time: cleanString(source.appointment_time),
    signing_type: normalizeSigningType(source.signing_type),
    fee: cleanNumber(source.fee),
    platform_fee: cleanNumber(source.platform_fee),
    client_name: cleanString(source.client_name),
    client_phone: cleanString(source.client_phone),
    client_email: cleanString(source.client_email),
    platform_name: cleanString(source.platform_name),
    notes: cleanString(source.notes),
  };

  const result = ParsedImportSchema.safeParse(candidate);
  if (result.success) {
    return result.data as ParsedImport;
  }
  // Fall back to per-field best effort: keep everything that passes its own type
  const partial: ParsedImport = {};
  for (const key of Object.keys(candidate) as Array<keyof ParsedImport>) {
    const field = candidate[key];
    if (field == null) continue;
    const check = z
      .string()
      .max(2000)
      .nullable()
      .optional()
      .or(z.number().min(0).max(100000).nullable().optional())
      .safeParse(field);
    if (check.success) {
      (partial[key] as unknown) = field;
    }
  }
  return partial;
}

function cleanString(value: unknown): string | undefined | null {
  if (value == null) return null;
  if (typeof value === 'number') return String(value);
  if (typeof value !== 'string') return null;
  const cleaned = value.trim();
  return cleaned || null;
}

function cleanNumber(value: unknown): number | undefined | null {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replace(/[$,]/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
