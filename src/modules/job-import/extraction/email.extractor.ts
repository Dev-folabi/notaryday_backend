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

  /** Collapse blank lines, trim, drop quoted-reply footers. */
  normalize(input: string): string {
    if (!input) return '';
    let text = input
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    // Drop Outlook/Gmail quoted reply blocks
    text = text
      .split(
        /\n(?:From:|Sent:|To:|Cc:|Bcc:|Subject:|-----Original Message-----)/i,
      )[0]
      .split(/\n(?:On .* wrote:)/i)[0]
      .replace(/\n>\s?.*/g, '')
      .trim();

    // Drop email signature lines after "Thanks," / "Best," / a name line
    text = text
      .split(
        /\n(?:thanks|thank you|best regards|regards|sincerely|sent from my iphone)/i,
      )[0]
      .trim();

    return text;
  }
}
