import { EmailExtractor } from './email.extractor';
import {
  DIRECT_EMAIL,
  GMAIL_FORWARDED_EMAIL,
  OUTLOOK_FORWARDED_EMAIL,
} from './test-fixtures';

describe('EmailExtractor', () => {
  let extractor: EmailExtractor;

  beforeEach(() => {
    extractor = new EmailExtractor();
  });

  it('keeps the full content of a direct email', () => {
    const text = extractor.normalize(DIRECT_EMAIL);
    expect(text).toContain('456 Oak Avenue');
    expect(text).toContain('Signing Type: Loan Refinance');
  });

  it('keeps the content of a Gmail-forwarded email', () => {
    const text = extractor.normalize(GMAIL_FORWARDED_EMAIL);
    expect(text).toContain('456 Oak Avenue');
    expect(text).toContain('Fee: $175.00');
    expect(text).not.toContain('Forwarded message');
    expect(text).not.toMatch(/^From:/m);
    expect(text).not.toMatch(/^Date:/m);
    expect(text).not.toMatch(/^Subject:/m);
  });

  it('keeps the content of an Outlook-forwarded email', () => {
    const text = extractor.normalize(OUTLOOK_FORWARDED_EMAIL);
    expect(text).toContain('456 Oak Avenue');
    expect(text).not.toContain('Begin forwarded message');
    expect(text).not.toMatch(/^Sent:/m);
  });

  it('strips quoted-reply blocks but keeps the reply body', () => {
    const reply = `Yes, I can make it Thursday.

On Thu, Aug 28, 2026 at 2:30 PM SnapDocs wrote:
> Signing Type: Loan Refinance
> Address: 456 Oak Avenue, Suite 200, Tampa, FL 33601
> Date & Time: August 28, 2026 at 2:30 PM EST
`;
    const text = extractor.normalize(reply);
    expect(text).toContain('Yes, I can make it Thursday.');
    expect(text).not.toContain('456 Oak Avenue');
  });

  it('strips HTML to text', () => {
    const html =
      '<html><body><p>Signing Type: Hybrid</p><p>Date: Sept 2, 2026 9:15 AM</p><p>Address: 12 Broadway Ave, New York, NY 10001</p><p>Fee: $200</p></body></html>';
    const text = extractor.toPlainText(html);
    expect(text).toContain('Signing Type: Hybrid');
    expect(text).toContain('12 Broadway Ave');
    expect(text).not.toContain('<');
  });
});
