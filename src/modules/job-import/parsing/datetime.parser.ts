import * as chrono from 'chrono-node';
import { FieldResult } from '../extraction/extraction.types';

/**
 * Parse a natural-language appointment time into an ISO 8601 string.
 *
 * Handles: "August 28, 2026 at 2:30 PM", "08/28/2026 2:30pm",
 * "Thursday, August 28, 2026 14:30", "2:30 PM" (with date found elsewhere).
 *
 * The returned string has no offset — it is treated as the notary's local
 * time by the rest of the app (matches how jobs store appointment_time).
 */
export function parseDateTime(text: string): FieldResult<string> {
  if (!text) return { value: null, confidence: 0 };

  const stripped = text
    .replace(/\b(am|pm)\s*(est|edt|cst|cdt|mst|mdt|pst|pdt)\b/gi, '$1')
    .trim();
  if (!stripped) return { value: null, confidence: 0 };

  // Skip pure "send to X at" phrasing with no concrete datetime signal
  if (!/[0-9]/.test(stripped)) return { value: null, confidence: 0 };

  // chrono does not join a date and a time on separate lines ("Signing date:
  // 08/28/2026" / "Time: 14:30"). Detect both tokens anywhere and combine.
  const combined = joinSeparateDateAndTime(stripped);
  const candidate = combined ?? stripped;

  const parsed = chrono.parseDate(candidate, new Date(), {
    forwardDate: true,
  });

  if (!parsed || isNaN(parsed.getTime())) return { value: null, confidence: 0 };

  const hasTime = /[0-9]{1,2}:[0-9]{2}\s*(am|pm)?|\d{1,2}\s*(am|pm)/i.test(
    candidate,
  );

  const iso = toLocalIso(parsed);

  // Very high confidence when an explicit 12/24h time is present.
  return { value: iso, confidence: hasTime ? 0.95 : 0.45 };
}

const DATE_TOKEN =
  /\b(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:,?\s+\d{4})?|\d{4}-\d{1,2}-\d{1,2})\b/i;

const TIME_TOKEN = /\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:am|pm)?\b/i;

/**
 * If the input has a date and a time on separate labeled lines, join them into
 * a single "date time" string so chrono resolves the correct instant.
 */
function joinSeparateDateAndTime(text: string): string | null {
  const dateMatch = text.match(DATE_TOKEN);
  const timeMatch = text.match(TIME_TOKEN);
  if (!dateMatch || !timeMatch) return null;

  // Already on the same line / adjacent — chrono handles it.
  const sameLine = text
    .split(/\r?\n/)
    .some((line) => line.includes(dateMatch[0]) && line.includes(timeMatch[0]));
  if (sameLine) return null;

  return `${dateMatch[0]} ${timeMatch[0]}`;
}

/** Format a Date as local ISO without trailing timezone (Y-m-dTH:i:s). */
export function toLocalIso(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}
