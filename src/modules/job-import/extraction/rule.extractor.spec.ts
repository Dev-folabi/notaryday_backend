import { RuleExtractor } from './rule.extractor';
import {
  GARBAGE_EMAIL,
  MINIMAL_EMAIL,
  SNAPDOCS_EMAIL,
  TITLESMART_EMAIL,
} from './test-fixtures';
import { SigningType } from '../../../../generated/prisma';

describe('RuleExtractor', () => {
  let extractor: RuleExtractor;

  beforeEach(() => {
    extractor = new RuleExtractor();
  });

  it('extracts all fields from a structured SnapDocs email', () => {
    const result = extractor.extract(SNAPDOCS_EMAIL);
    expect(result.parsed.address).toContain('456 Oak Avenue');
    expect(result.parsed.appointment_time).toMatch(/^2026-08-28T14:30:00$/);
    expect(result.parsed.signing_type).toBe(SigningType.LOAN_REFI);
    expect(result.parsed.fee).toBe(175);
    expect(result.parsed.platform_fee).toBe(25);
    expect(result.parsed.client_name).toMatch(
      /First National Bank|James Rodriguez/i,
    );
    expect(result.parsed.client_phone).toContain('5550199');
    expect(result.parsed.platform_name?.toLowerCase()).toContain('snapdocs');
    expect(result.confidence).toBeGreaterThan(0.7);
  });

  it('extracts a purchase closing from TitleSmart email', () => {
    const result = extractor.extract(TITLESMART_EMAIL);
    expect(result.parsed.signing_type).toBe(SigningType.PURCHASE_CLOSING);
    expect(result.parsed.address).toContain('789 Pine Road');
    expect(result.parsed.appointment_time).toMatch(/^2026-08-28T14:30:00$/);
    expect(result.parsed.client_name).toBe('Sarah Mitchell');
    expect(result.parsed.platform_name).toBe('TitleSmart');
    expect(result.parsed.notes).toContain('wet ink');
    expect(result.confidence).toBeGreaterThan(0.7);
  });

  it('extracts from a minimal one-line email', () => {
    const result = extractor.extract(MINIMAL_EMAIL);
    expect(result.parsed.address).toContain('123 Main Street');
    expect(result.parsed.appointment_time).toMatch(/^2026-09-01T10:00:00$/);
    expect(result.parsed.fee).toBe(120);
  });

  it('returns near-zero confidence on garbage text', () => {
    const result = extractor.extract(GARBAGE_EMAIL);
    expect(result.confidence).toBeLessThan(0.3);
    expect(result.parsed.address).toBeNull();
  });

  it('optional fields alone never push confidence above threshold', () => {
    // Only client/platform/notes present (no address/time/type/fee)
    const text =
      'Client: John Doe\nPlatform: SnapDocs\nNotes: Please call first';
    const result = extractor.extract(text);
    expect(result.confidence).toBeLessThan(0.7);
  });
});
