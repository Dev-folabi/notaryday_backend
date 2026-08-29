import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JobExtractionService } from './job-extraction.service';
import { EmailExtractor } from './email.extractor';
import { OCRExtractor } from './ocr.extractor';
import { RuleExtractor } from './rule.extractor';
import { GeminiExtractor } from './gemini.extractor';
import { OpenRouterExtractor } from './openrouter.extractor';
import { AIExtractor } from './extraction.types';
import { SigningType } from '../../../../generated/prisma';
import {
  GMAIL_FORWARDED_EMAIL,
  OUTLOOK_FORWARDED_EMAIL,
} from './test-fixtures';

function makeModule(overrides: {
  geminiConfigured?: boolean;
  openRouterConfigured?: boolean;
  threshold?: number;
  gemini?: Partial<AIExtractor>;
  openRouter?: Partial<AIExtractor>;
  ocr?: { extractText: jest.Mock };
}) {
  const config = {
    get: jest.fn((key: string) => {
      if (key === 'EXTRACTION_CONFIDENCE_THRESHOLD') {
        return overrides.threshold ?? 0.7;
      }
      if (key === 'GEMINI_API_KEY') {
        return overrides.geminiConfigured === false ? '' : 'test-gemini-key';
      }
      if (key === 'GEMINI_MODEL') return 'gemini-3.6-flash';
      if (key === 'OPENROUTER_API_KEY') {
        return overrides.openRouterConfigured === false ? '' : 'test-or-key';
      }
      return undefined;
    }),
  };

  const gemini = {
    name: 'gemini',
    isConfigured: overrides.geminiConfigured !== false,
    extractFromText: jest.fn(),
    extractFromImage: jest.fn(),
    ...overrides.gemini,
  } as unknown as GeminiExtractor;

  const openRouter = {
    name: 'openrouter',
    isConfigured: overrides.openRouterConfigured !== false,
    extractFromText: jest.fn(),
    extractFromImage: jest.fn(),
    ...overrides.openRouter,
  } as unknown as OpenRouterExtractor;

  return Test.createTestingModule({
    providers: [
      JobExtractionService,
      { provide: ConfigService, useValue: config },
      { provide: EmailExtractor, useValue: new EmailExtractor() },
      {
        provide: OCRExtractor,
        useValue: overrides.ocr ?? { extractText: jest.fn() },
      },
      { provide: RuleExtractor, useValue: new RuleExtractor() },
      { provide: GeminiExtractor, useValue: gemini },
      { provide: OpenRouterExtractor, useValue: openRouter },
    ],
  }).compile();
}

describe('JobExtractionService (hybrid pipeline)', () => {
  it('uses rule extraction only when confidence is high (no AI call)', async () => {
    const module = await makeModule({});
    const service = module.get(JobExtractionService);
    const gemini = module.get(GeminiExtractor);
    const result = await service.extractFromEmail(
      `Signing Type: Loan Refi
Date & Time: August 28, 2026 at 2:30 PM
Address: 456 Oak Ave, Tampa, FL 33601
Fee: $175
Platform Fee: $25`,
    );
    expect(result.method).toBe('rule');
    expect(result.parsed.address).toContain('456 Oak Ave');
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
    expect(gemini.extractFromText).not.toHaveBeenCalled();
  });

  it('parses a Gmail-forwarded email like a direct email (no AI needed)', async () => {
    const module = await makeModule({});
    const service = module.get(JobExtractionService);
    const gemini = module.get(GeminiExtractor);
    const result = await service.extractFromEmail(GMAIL_FORWARDED_EMAIL);
    expect(result.method).toBe('rule');
    expect(result.parsed.address).toContain('456 Oak Avenue');
    expect(result.parsed.appointment_time).toMatch(/^2026-08-28T14:30:00$/);
    expect(result.parsed.signing_type).toBe(SigningType.LOAN_REFI);
    expect(result.parsed.fee).toBe(175);
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
    expect(gemini.extractFromText).not.toHaveBeenCalled();
  });

  it('parses an Outlook-forwarded email like a direct email', async () => {
    const module = await makeModule({});
    const service = module.get(JobExtractionService);
    const result = await service.extractFromEmail(OUTLOOK_FORWARDED_EMAIL);
    expect(result.method).toBe('rule');
    expect(result.parsed.address).toContain('456 Oak Avenue');
    expect(result.parsed.appointment_time).toMatch(/^2026-08-28T14:30:00$/);
    expect(result.parsed.fee).toBe(175);
  });

  it('falls back to AI (hybrid) when confidence is low, filling low-confidence fields', async () => {
    const geminiCall = jest.fn().mockResolvedValue({
      parsed: {
        address: '123 Elm Street, Denver, CO 80202',
        appointment_time: '2026-09-05T13:00:00',
        signing_type: SigningType.GENERAL,
        fee: 150,
      },
      model: 'gemini-3.6-flash',
    });
    const module = await makeModule({
      gemini: { extractFromText: geminiCall },
    });
    const service = module.get(JobExtractionService);

    // Vague text → low rule confidence
    const result = await service.extractFromEmail(
      'Signing on the 5th somewhere in Denver, around 1pm. ~$150.',
    );
    expect(result.method).toBe('hybrid');
    expect(geminiCall).toHaveBeenCalledTimes(1);
    expect(result.aiModel).toBe('gemini-3.6-flash');
    expect(result.parsed.address).toBe('123 Elm Street, Denver, CO 80202');
  });

  it('falls back to rule result when AI fails', async () => {
    const module = await makeModule({
      gemini: {
        extractFromText: jest.fn().mockRejectedValue(new Error('quota')),
      },
    });
    const service = module.get(JobExtractionService);
    const result = await service.extractFromEmail('something vague 2026');
    expect(result.method).toBe('rule'); // best-effort rule fallback
  });

  it('prefers rule values for high-confidence fields in hybrid merge', async () => {
    const geminiCall = jest.fn().mockResolvedValue({
      parsed: {
        client_name: 'Wrong AI Name',
        address: '999 Wrong St, TX 11111',
      },
      model: 'gemini-3.6-flash',
    });
    const module = await makeModule({
      gemini: { extractFromText: geminiCall },
    });
    const service = module.get(JobExtractionService);

    // Address-only input → rule confidence is low (overall), triggering AI,
    // but the rule address itself is high-confidence and must win the merge.
    const result = await service.extractFromEmail(
      'Address: 123 Elm Street, Denver, CO 80202',
    );
    expect(result.method).toBe('hybrid');
    expect(result.parsed.address).toBe('123 Elm Street, Denver, CO 80202');
  });

  it('tries Gemini then OpenRouter when Gemini is down', async () => {
    const geminiCall = jest.fn().mockRejectedValue(new Error('down'));
    const orCall = jest.fn().mockResolvedValue({
      parsed: { address: '42 Fake St, Burbank, CA 91505', fee: 200 },
      model: 'or-model',
    });
    const module = await makeModule({
      gemini: { extractFromText: geminiCall },
      openRouter: { extractFromText: orCall },
    });
    const service = module.get(JobExtractionService);
    const result = await service.extractFromEmail('vague text 2026');
    expect(geminiCall).toHaveBeenCalled();
    expect(orCall).toHaveBeenCalled();
    expect(result.aiModel).toBe('or-model');
  });

  it('runs AI when no providers configured if confidence low (returns rule result)', async () => {
    const module = await makeModule({
      geminiConfigured: false,
      openRouterConfigured: false,
    });
    const service = module.get(JobExtractionService);
    const result = await service.extractFromEmail('garbage text with no data');
    expect(result.method).toBe('rule');
  });

  it('falls back to AI vision when OCR fails instead of failing the import', async () => {
    const geminiVision = jest.fn().mockResolvedValue({
      parsed: { address: '88 Vision St, Atlanta, GA 30301' },
      model: 'gemini-3.6-flash',
    });
    const module = await makeModule({
      ocr: { extractText: jest.fn().mockRejectedValue(new Error('ocr boom')) },
      gemini: { extractFromImage: geminiVision },
    });
    const service = module.get(JobExtractionService);
    const result = await service.extractFromScreenshot(
      Buffer.from('fake-image'),
      'image/png',
    );
    // OCR failed but the import still resolves via Gemini vision.
    expect(result.parsed.address).toBe('88 Vision St, Atlanta, GA 30301');
    expect(result.aiModel).toBe('gemini-3.6-flash');
    expect(geminiVision).toHaveBeenCalledWith(
      Buffer.from('fake-image'),
      'image/png',
      '',
    );
  });
});
