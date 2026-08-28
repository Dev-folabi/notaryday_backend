import { FieldResult } from '../extraction/extraction.types';

const MONEY = /\$\s?([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)/;

/** Confidence bump when the match is on a labeled fee line. */
function labelBoost(label: string, lower: string): number {
  return lower.includes(label) ? 0.3 : 0;
}

export function parseFee(text: string): FieldResult<number> {
  const lines = text.split(/\r?\n/);
  const lower = text.toLowerCase();

  const isPlatformLine = (line: string) =>
    /(platform fee|platform deduction|snapdocs fee|signing service fee|service fee|less platform)/i.test(
      line,
    );

  // Look for labeled fee lines first (fee / total / commission / amount due),
  // skipping explicit platform-fee lines so they don't win the "total" slot.
  const feeLabels = [
    'notary fee',
    'signing fee',
    'total fee',
    'total',
    'commission',
    'amount due',
    'fee:',
    'fee ',
  ];
  for (const label of feeLabels) {
    for (const line of lines) {
      const lineLower = line.toLowerCase();
      if (!lineLower.includes(label)) continue;
      if (isPlatformLine(line)) continue;
      const match = line.match(MONEY);
      if (match) {
        const value = parseFloat(match[1].replace(/,/g, ''));
        // 0 is almost always noise
        if (value > 0) {
          return {
            value,
            confidence: 0.7 + labelBoost(label, lineLower),
          };
        }
      }
    }
  }

  // Bare currency anywhere in text (first $N value, excluding platform fee lines)
  const linesWithoutPlatform = lines
    .filter((l) => !isPlatformLine(l))
    .join('\n');
  const match = linesWithoutPlatform.match(MONEY);
  if (match) {
    const value = parseFloat(match[1].replace(/,/g, ''));
    if (value > 0) {
      return { value, confidence: lower.includes('platform fee') ? 0.55 : 0.6 };
    }
  }

  return { value: null, confidence: 0 };
}

export function parsePlatformFee(text: string): FieldResult<number> {
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (
      !/(platform fee|platform deduction|snapdocs fee|service fee|signing service fee|less platform)/.test(
        lower,
      )
    ) {
      continue;
    }
    const match = line.match(MONEY);
    if (match) {
      const value = parseFloat(match[1].replace(/,/g, ''));
      if (value > 0) return { value, confidence: 0.9 };
    }
  }
  return { value: null, confidence: 0 };
}
