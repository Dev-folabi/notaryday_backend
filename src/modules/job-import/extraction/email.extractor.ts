import { Injectable } from '@nestjs/common';
import { htmlToText } from 'html-to-text';

/**
 * Converts raw email input into clean, parseable plain text.
 * Resend delivers text + html; when only HTML is available we strip tags.
 */
@Injectable()
export class EmailExtractor {
  toPlainText(input: string): string {
    if (!input) return '';
    const looksLikeHtml =
      /<\s*(p|div|span|br|table|tr|td|a|li|h[1-6])\b/i.test(input) ||
      /<html|<!doctype/i.test(input);

    let text = input;
    if (looksLikeHtml) {
      try {
        text = htmlToText(input, {
          wordwrap: false,
          baseElements: {
            selectors: [
              'p',
              'div',
              'span',
              'li',
              'td',
              'tr',
              'br',
              'h1',
              'h2',
              'h3',
              'h4',
              'h5',
              'h6',
              'a',
            ],
          },
        });
      } catch {
        text = input.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      }
    }

    return this.normalize(text);
  }

  /**
   * Collapse blank lines, trim, drop quoted-reply content and forwarded-message
   * header blocks.
   */
  normalize(input: string): string {
    if (!input) return '';
    let text = input
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    text = stripQuotedAndForwarded(text);

    // Drop email signature lines after "Thanks," / "Best," / a name line
    text = text
      .split(
        /\n(?:thanks|thank you|best regards|regards|sincerely|sent from my iphone)/i,
      )[0]
      .trim();

    return text;
  }
}

const FORWARD_MARKERS = [
  /^[-=]{5,}\s*forwarded message\s*[-=]{5,}\s*$/i,
  /^[-=]{5,}\s*forwarded\s*[-=]{5,}\s*$/i,
  /^begin forwarded message:\s*$/i,
  /^-----original message-----\s*$/i,
  /^---\s*forwarded\s*message\s*---\s*$/i,
];

const EMAIL_HEADER =
  /^(?:from|sent|to|cc|bcc|subject|date|reply-to|message-id|mime-version|content-type):/i;

const REPLY_MARKER = /^on\s+.+\s+wrote:\s*$/i;

function stripQuotedAndForwarded(text: string): string {
  const lines = text.split('\n');
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Quoted reply content — noise, drop entirely.
    if (/^>\s?/.test(line)) {
      i++;
      continue;
    }

    // "On X wrote:" — everything after is a quoted reply; stop.
    if (REPLY_MARKER.test(line)) break;

    // Forward marker — skip it and the header/blank lines that follow, but
    // KEEP the message body (that is where the job details live).
    if (FORWARD_MARKERS.some((re) => re.test(line))) {
      i++;
      while (
        i < lines.length &&
        (EMAIL_HEADER.test(lines[i]) || !lines[i].trim())
      ) {
        i++;
      }
      continue;
    }

    // Markerless forward (Outlook): a run of 2+ email header lines marks the
    // forwarded block. Skip the header run and trailing blank, keep the body.
    if (EMAIL_HEADER.test(line)) {
      let j = i;
      while (j < lines.length && EMAIL_HEADER.test(lines[j])) j++;
      if (j - i >= 2) {
        i = j;
        while (i < lines.length && !lines[i].trim()) i++;
        continue;
      }
    }

    result.push(line);
    i++;
  }

  return result.join('\n').trim();
}
