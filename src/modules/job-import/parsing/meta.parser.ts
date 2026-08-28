import { FieldResult } from '../extraction/extraction.types';

const KNOWN_PLATFORMS = [
  'snapdocs',
  'notarize',
  'notarycam',
  'nations eclose',
  'nexvia',
  'courtdirect',
  'signing order',
  'the title group',
  'title365',
  'signinglink',
];

/** Read a labeled field value, stopping at the next label or line boundary. */
function labeledValue(text: string, labels: string[]): FieldResult<string> {
  const labelRe = new RegExp(
    `\\b(?:${labels.join('|')})\\s*[:.-]?\\s*([^\\n\\r]+)`,
    'i',
  );
  const match = text.match(labelRe);
  if (!match) return { value: null, confidence: 0 };
  let value = match[1].trim();
  // Strip trailing field label noise
  value = value
    .replace(/\s{2,}/g, ' ')
    .replace(/\s*(fee|email|phone|address):?.*$/i, '')
    .trim();
  if (!value) return { value: null, confidence: 0 };
  // If the whole line was captured, strip nothing further
  return { value, confidence: 0.85 };
}

export function parseClientName(text: string): FieldResult<string> {
  const result = labeledValue(text, [
    'client name',
    'client',
    'borrower',
    'customer',
    'signer',
    'homeowner',
  ]);
  if (result.value) return result;
  return { value: null, confidence: 0 };
}

export function parsePlatformName(text: string): FieldResult<string> {
  const result = labeledValue(text, [
    'platform',
    'signing service',
    'ordering company',
    'company',
    'title company',
  ]);
  if (result.value) return result;

  // Heuristic: known platform mentioned anywhere
  const lower = text.toLowerCase();
  for (const platform of KNOWN_PLATFORMS) {
    if (lower.includes(platform)) {
      return {
        value: platform.replace(/\b\w/g, (c) => c.toUpperCase()),
        confidence: 0.7,
      };
    }
  }
  return { value: null, confidence: 0 };
}

export function parseNotes(text: string): FieldResult<string> {
  const result = labeledValue(text, [
    'special instructions',
    'additional information',
    'additional instructions',
    'notes',
    'note',
    'comments',
    'remarks',
  ]);
  if (result.value) return result;

  // Fallback: any capitalized sentence that isn't a known label line
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const noise =
    /^(fee|total|platform|date|time|address|client|borrower|signing|subject|from|to|thanks|dear|regards|thank|sincerely)/i;
  const candidates = lines.filter((l) => !noise.test(l) && l.length > 20);
  if (candidates.length > 0) {
    return { value: candidates.join(' '), confidence: 0.4 };
  }
  return { value: null, confidence: 0 };
}
