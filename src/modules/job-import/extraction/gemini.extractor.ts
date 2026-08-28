import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';
import { AIExtractionResult, AIExtractor } from './extraction.types';
import { normalizeParsedImport } from './extract.schemas';

const SYSTEM_PROMPT = `You are an expert data extraction assistant for a mobile notary scheduling app.
Extract signing appointment details from the provided email text or screenshot OCR text.
Return ONLY valid JSON. Use null for any field you cannot determine.
Fields:
- address: full street address (street, city, state, zip)
- appointment_time: ISO 8601 datetime string (e.g. 2026-08-28T14:30:00)
- signing_type: one of GENERAL, LOAN_REFI, HYBRID, PURCHASE_CLOSING, FIELD_INSPECTION, APOSTILLE
- fee: the total notary/signing fee in dollars (number)
- platform_fee: any platform/service fee deducted (number)
- client_name: borrower or client name
- client_phone: borrower phone number
- client_email: borrower email address
- platform_name: the platform or title company that sent the order (e.g. Snapdocs)
- notes: any special instructions or additional relevant details
Do not invent data. Only extract what is present.`;

const JSON_SCHEMA = {
  type: 'OBJECT',
  properties: {
    address: { type: 'STRING', nullable: true },
    appointment_time: { type: 'STRING', nullable: true },
    signing_type: { type: 'STRING', nullable: true },
    fee: { type: 'NUMBER', nullable: true },
    platform_fee: { type: 'NUMBER', nullable: true },
    client_name: { type: 'STRING', nullable: true },
    client_phone: { type: 'STRING', nullable: true },
    client_email: { type: 'STRING', nullable: true },
    platform_name: { type: 'STRING', nullable: true },
    notes: { type: 'STRING', nullable: true },
  },
  required: [],
};

@Injectable()
export class GeminiExtractor implements AIExtractor {
  readonly name = 'gemini';
  private readonly logger = new Logger(GeminiExtractor.name);
  private readonly client: GoogleGenAI | null;
  private readonly model: string;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('GEMINI_API_KEY');
    this.model = this.config.get<string>('GEMINI_MODEL') ?? 'gemini-2.5-flash';
    this.client = apiKey ? new GoogleGenAI({ apiKey }) : null;
  }

  get isConfigured(): boolean {
    return !!this.client;
  }

  async extractFromText(text: string): Promise<AIExtractionResult> {
    if (!this.client) throw new Error('Gemini is not configured');
    return this.request([{ role: 'user', parts: [{ text }] }]);
  }

  async extractFromImage(
    image: Buffer,
    mimeType: string,
    ocrText?: string,
  ): Promise<AIExtractionResult> {
    if (!this.client) throw new Error('Gemini is not configured');
    const parts: Array<{ inlineData?: object; text?: string }> = [];
    if (ocrText) {
      parts.push({
        text: `Here is OCR text extracted from the screenshot (use it as reference):\n${ocrText}`,
      });
    }
    parts.push({
      inlineData: {
        mimeType,
        data: image.toString('base64'),
      },
    });
    return this.request([{ role: 'user', parts }]);
  }

  private async request(
    contents: Array<Record<string, unknown>>,
  ): Promise<AIExtractionResult> {
    if (!this.client) throw new Error('Gemini is not configured');

    const MAX_RETRIES = 2;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await this.client.models.generateContent({
          model: this.model,
          contents,
          config: {
            systemInstruction: SYSTEM_PROMPT,
            temperature: 0,
            responseMimeType: 'application/json',
            responseSchema: JSON_SCHEMA,
          },
        });

        const rawText = response.text ?? '';
        if (!rawText) throw new Error('Gemini returned an empty response');

        let parsed: unknown;
        try {
          parsed = JSON.parse(rawText);
        } catch {
          const match = rawText.match(/\{[\s\S]*\}/);
          if (!match) throw new Error('No JSON in Gemini response');
          parsed = JSON.parse(match[0]);
        }

        return {
          parsed: normalizeParsedImport(parsed),
          model: this.model,
          tokensUsed: response.usageMetadata?.totalTokenCount ?? undefined,
        };
      } catch (err) {
        const isRateLimit = this.isRateLimit(err);
        if (isRateLimit && attempt < MAX_RETRIES) {
          const delay = attempt * 4000;
          this.logger.warn(
            `Gemini rate limited/quota (attempt ${attempt}/${MAX_RETRIES}), retrying in ${delay}ms`,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        throw err;
      }
    }
    throw new Error('Gemini retry exhausted');
  }

  private isRateLimit(err: unknown): boolean {
    const value =
      (err as { status?: number | string })?.status ??
      (err as { code?: number })?.code ??
      (err as { message?: string })?.message ??
      '';
    if (typeof value === 'string') {
      return /429|resource exhausted|quota|rate.?limit/i.test(value);
    }
    return value === 429;
  }
}
