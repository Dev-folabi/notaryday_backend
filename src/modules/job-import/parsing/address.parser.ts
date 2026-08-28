import { FieldResult } from '../extraction/extraction.types';

const STREET_SUFFIXES =
  '(street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|court|ct|circle|cir|way|terrace|ter|place|pl|highway|hwy|parkway|pkwy|trail|trl|loop|square|sq|row|point|pt|pike|run|view|vw|trace|trc|turning|twn|bend|vista|vis|common|cmn)';

const UNIT =
  '(?:\\s*(?:unit|suite|ste|apt|apartment|#|no\\.?|bldg)\\s*[A-Za-z0-9-]+)?';

const STATE = [
  'AL',
  'AK',
  'AZ',
  'AR',
  'CA',
  'CO',
  'CT',
  'DE',
  'FL',
  'GA',
  'HI',
  'ID',
  'IL',
  'IN',
  'IA',
  'KS',
  'KY',
  'LA',
  'ME',
  'MD',
  'MA',
  'MI',
  'MN',
  'MS',
  'MO',
  'MT',
  'NE',
  'NV',
  'NH',
  'NJ',
  'NM',
  'NY',
  'NC',
  'ND',
  'OH',
  'OK',
  'OR',
  'PA',
  'RI',
  'SC',
  'SD',
  'TN',
  'TX',
  'UT',
  'VT',
  'VA',
  'WA',
  'WV',
  'WI',
  'WY',
];

const STATE_RE = new RegExp(`\\b(${STATE.join('|')})\\b`, 'i');

/** Strip a leading label ("Address:", "Location:", "at", "Property:") from a line. */
function stripLabel(line: string): string {
  return line
    .replace(
      /^\s*(?:address|location|property|site|appointment address|meeting place)\s*[:.-]?\s*/i,
      '',
    )
    .replace(/^\s*(?:at|located at|venue)\s+/i, '')
    .trim();
}

/**
 * Extract a US street address. Matches the most address-looking line:
 *   <num> <street name> <suffix>[ <unit>][, <city>, <ST> <zip>]
 */
export function parseAddress(text: string): FieldResult<string> {
  const lines = text.split(/\r?\n/);

  // 1) Prefer a line that has street number + suffix + state + zip
  for (const line of lines) {
    const candidate = stripLabel(line);
    if (!candidate) continue;
    const streetMatch = candidate.match(
      new RegExp(
        `\\b[0-9]{1,6}\\s+[A-Za-z0-9.\\-' ]+?\\s+${STREET_SUFFIXES}\\b${UNIT}`,
        'i',
      ),
    );
    if (!streetMatch) continue;
    const hasState = STATE_RE.test(candidate);
    const hasZip = /\b\d{5}(?:-\d{4})?\b/.test(candidate);
    if (hasState && hasZip) {
      return { value: candidate, confidence: 0.95 };
    }
  }

  // 2) Any line with street number + suffix (may miss state/zip line break)
  for (const line of lines) {
    const candidate = stripLabel(line);
    if (!candidate) continue;
    const streetMatch = candidate.match(
      new RegExp(
        `\\b[0-9]{1,6}\\s+[A-Za-z0-9.\\-' ]+?\\s+${STREET_SUFFIXES}\\b${UNIT}`,
        'i',
      ),
    );
    if (streetMatch) {
      const hasZip = /\b\d{5}(?:-\d{4})?\b/.test(candidate);
      return { value: candidate, confidence: hasZip ? 0.85 : 0.6 };
    }
  }

  // 3) "at 123 Main St" inline inside a longer line
  const inline = text.match(
    new RegExp(
      `\\b(?:at|address:?\\s*)?([0-9]{1,6}\\s+[A-Za-z0-9.\\-' ]+?\\s+${STREET_SUFFIXES}\\b${UNIT})`,
      'i',
    ),
  );
  if (inline) {
    return { value: inline[1].trim(), confidence: 0.6 };
  }

  return { value: null, confidence: 0 };
}
