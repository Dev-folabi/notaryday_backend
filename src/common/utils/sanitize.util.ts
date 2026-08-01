/**
 * Sanitize free-text input before persisting. Strips HTML tags, control
 * characters, collapses whitespace and caps length. Used as a defense-in-depth
 * layer alongside class-validator on the DTOs.
 */
export function sanitizeText(value: unknown, maxLength = 500): unknown {
  if (typeof value !== 'string') return value;
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

/**
 * Sanitize every string field in a plain object (values of other types pass
 * through untouched).
 */
export function sanitizeStrings<T extends object>(
  input: T,
  maxLength = 500,
): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    out[key] = sanitizeText(value, maxLength);
  }
  return out as T;
}
