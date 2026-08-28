import { parseAddress } from './address.parser';
import { parseDateTime } from './datetime.parser';
import { parseFee, parsePlatformFee } from './fee.parser';
import { parseEmail, parsePhone } from './contact.parser';
import { parseSigningType, normalizeSigningType } from './signing-type.parser';
import { SigningType } from '../../../../generated/prisma';

describe('parsing', () => {
  describe('address.parser', () => {
    it('extracts a full street address with city/state/zip', () => {
      const result = parseAddress(
        'Address: 456 Oak Avenue, Suite 200, Tampa, FL 33601',
      );
      expect(result.value).toContain('456 Oak Avenue');
      expect(result.confidence).toBeGreaterThan(0.9);
    });

    it('returns null when no street pattern exists', () => {
      expect(parseAddress('no address here').value).toBeNull();
    });
  });

  describe('datetime.parser', () => {
    it('parses long-form date and time', () => {
      const result = parseDateTime(
        'Date & Time: August 28, 2026 at 2:30 PM EST',
      );
      expect(result.value).toMatch(/^2026-08-28T14:30:00$/);
      expect(result.confidence).toBeGreaterThan(0.9);
    });

    it('parses numeric date and 24h time', () => {
      const result = parseDateTime('08/28/2026 14:30');
      expect(result.value).toMatch(/^2026-08-28T14:30:00$/);
    });

    it('rejects text with no digits', () => {
      expect(parseDateTime('sometime next week').value).toBeNull();
    });
  });

  describe('fee.parser', () => {
    it('extracts labeled fee', () => {
      expect(parseFee('Fee: $175.00').value).toBe(175);
    });

    it('extracts platform fee only from labeled lines', () => {
      expect(parsePlatformFee('Platform Fee: $25.00').value).toBe(25);
      expect(parsePlatformFee('Total: $175.00').value).toBeNull();
    });
  });

  describe('contact.parser', () => {
    it('normalizes a phone number', () => {
      const result = parsePhone('Call (813) 555-0199');
      expect(result.value).toContain('5550199');
    });

    it('extracts an email', () => {
      expect(parseEmail('reach me at bob@example.com today').value).toBe(
        'bob@example.com',
      );
    });
  });

  describe('signing-type.parser', () => {
    it('maps loan refi keywords', () => {
      expect(parseSigningType('Loan Refinance').value).toBe(
        SigningType.LOAN_REFI,
      );
    });

    it('maps purchase closing keywords', () => {
      expect(parseSigningType('Purchase Closing').value).toBe(
        SigningType.PURCHASE_CLOSING,
      );
    });

    it('normalizes AI lowercase output to enum', () => {
      expect(normalizeSigningType('loan_refi')).toBe(SigningType.LOAN_REFI);
      expect(normalizeSigningType('purchase closing')).toBe(
        SigningType.PURCHASE_CLOSING,
      );
      expect(normalizeSigningType('garbage')).toBeNull();
    });
  });
});
