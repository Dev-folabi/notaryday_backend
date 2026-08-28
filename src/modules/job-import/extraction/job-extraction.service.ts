import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailExtractor } from './email.extractor';
import { OCRExtractor } from './ocr.extractor';
import { RuleExtractor } from './rule.extractor';
import { GeminiExtractor } from './gemini.extractor';
import { OpenRouterExtractor } from './openrouter.extractor';
import {
  AIExtractor,
  ExtractionOutcome,
  ParsedImport,
  RuleExtractionResult,
} from './extraction.types';
import { normalizeParsedImport } from './extract.schemas';

/**
 * Orchestrates the job-information extraction pipeline:
 *
 * AI is ONLY invoked when the overall rule confidence is below threshold.
 * Missing optional fields (client/platform/notes) have negligible weight and
 * never trigger AI on their own.
 */
@Injectable()
export class JobExtractionService {
  private readonly logger = new Logger(JobExtractionService.name);
  private readonly threshold: number;
  private readonly providers: AIExtractor[];

  constructor(
    private readonly config: ConfigService,
    private readonly emailExtractor: EmailExtractor,
    private readonly ocrExtractor: OCRExtractor,
    private readonly ruleExtractor: RuleExtractor,
    private readonly gemini: GeminiExtractor,
    private readonly openRouter: OpenRouterExtractor,
  ) {
    this.threshold =
      this.config.get<number>('EXTRACTION_CONFIDENCE_THRESHOLD') ?? 0.7;
    this.providers = [];
    if (this.gemini.isConfigured) this.providers.push(this.gemini);
    if (this.openRouter.isConfigured) this.providers.push(this.openRouter);
  }

  async extractFromEmail(rawText: string): Promise<ExtractionOutcome> {
    const text = this.emailExtractor.toPlainText(rawText);
    if (!text.trim()) {
      return { parsed: {}, method: 'rule', confidence: 0 };
    }
    return this.runPipeline(text);
  }

  async extractFromScreenshot(
    imageBuffer: Buffer,
    mimeType: string,
  ): Promise<ExtractionOutcome> {
    // OCR is best-effort: if it fails, still hand the raw image to AI vision
    // rather than failing the whole import.
    let ocrText = '';
    try {
      ocrText = await this.ocrExtractor.extractText(imageBuffer);
      this.logger.log(
        `OCR complete (${ocrText.length} chars) for screenshot (${mimeType})`,
      );
    } catch (err) {
      this.logger.warn(
        `OCR failed (${err instanceof Error ? err.message : String(err)}), falling back to AI vision`,
      );
    }
    const text = this.emailExtractor.normalize(ocrText);
    const outcome = await this.runPipeline(text, {
      imageBuffer,
      mimeType,
    });
    return { ...outcome, ocrText: text };
  }

  private async runPipeline(
    text: string,
    image?: { imageBuffer: Buffer; mimeType: string },
  ): Promise<ExtractionOutcome> {
    const rule = this.ruleExtractor.extract(text);

    // High confidence: deterministic result is good enough — no AI needed.
    if (rule.confidence >= this.threshold || this.providers.length === 0) {
      this.logger.log(
        `[extract] rule parser (confidence=${rule.confidence.toFixed(2)})`,
      );
      return {
        parsed: rule.parsed,
        method: 'rule',
        confidence: rule.confidence,
      };
    }

    // Low confidence: ask AI to fill only the low-confidence fields.
    try {
      const aiResult = await this.callAI(text, image);
      const merged = this.merge(rule, aiResult.parsed);
      this.logger.log(
        `[extract] rule + ${aiResult.model} hybrid (rule confidence=${rule.confidence.toFixed(2)})`,
      );
      return {
        parsed: merged,
        method: 'hybrid',
        confidence: rule.confidence,
        aiModel: aiResult.model,
        aiTokensUsed: aiResult.tokensUsed,
      };
    } catch (err) {
      this.logger.warn(
        `AI extraction failed for ${image ? 'screenshot' : 'email'}, falling back to rule result: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return {
        parsed: rule.parsed,
        method: 'rule',
        confidence: rule.confidence,
      };
    }
  }

  /** Try each configured AI provider in order until one succeeds. */
  private async callAI(
    text: string,
    image?: { imageBuffer: Buffer; mimeType: string },
  ) {
    let lastError: unknown = new Error('No AI provider configured');
    for (const provider of this.providers) {
      try {
        const result = image
          ? await provider.extractFromImage(
              image.imageBuffer,
              image.mimeType,
              text,
            )
          : await provider.extractFromText(text);
        this.logger.log(
          `[extract] AI provider "${provider.name}" succeeded (model=${result.model})`,
        );
        return result;
      } catch (err) {
        lastError = err;
        this.logger.warn(
          `AI provider ${provider.name} failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    throw lastError;
  }

  /**
   * Hybrid merge: keep every rule-extracted field whose confidence is at/above
   * the threshold; fill the rest from AI (which we also normalize/validate).
   * AI nulls never overwrite a rule value.
   */
  private merge(
    rule: RuleExtractionResult,
    aiRaw: Partial<ParsedImport>,
  ): ParsedImport {
    const ai = normalizeParsedImport(aiRaw);
    const merged: ParsedImport = { ...rule.parsed };

    for (const field of Object.keys(ai) as Array<keyof ParsedImport>) {
      const ruleConf = rule.fieldConfidence[field] ?? 0;
      if (ruleConf >= this.threshold) continue; // keep the reliable rule value
      const aiValue = ai[field];
      if (aiValue != null) {
        (merged as Record<string, unknown>)[field] = aiValue;
      }
    }
    return merged;
  }
}
