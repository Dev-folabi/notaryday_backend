import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
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
All field nullable, do not invent data. Only extract what is present.`;

const MAX_AI_RETRIES = 3;

/**
 * OpenRouter fallback provider (kept behind the AIExtractor interface so it
 * can be swapped out later). Enabled only when OPENROUTER_API_KEY is set.
 */
@Injectable()
export class OpenRouterExtractor implements AIExtractor {
  readonly name = 'openrouter';
  private readonly logger = new Logger(OpenRouterExtractor.name);
  private readonly apiKey: string;
  private readonly textModel: string;
  private readonly visionModel: string;

  constructor(private readonly config: ConfigService) {
    this.apiKey = this.config.get<string>('OPENROUTER_API_KEY') ?? '';
    this.textModel =
      this.config.get<string>('OPENROUTER_DEFAULT_MODEL') ??
      'google/gemma-4-26b-a4b-it:free';
    this.visionModel =
      this.config.get<string>('OPENROUTER_VISION_MODEL') ??
      'google/gemma-4-26b-a4b-it:free';
  }

  get isConfigured(): boolean {
    return !!this.apiKey;
  }

  async extractFromText(text: string): Promise<AIExtractionResult> {
    return this.callAi(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: text },
      ],
      this.textModel,
    );
  }

  async extractFromImage(
    image: Buffer,
    mimeType: string,
    ocrText?: string,
  ): Promise<AIExtractionResult> {
    const contentParts: Array<Record<string, unknown>> = [
      {
        type: 'text',
        text: `Extract the signing details from this image${ocrText ? ` (OCR reference: ${ocrText.slice(0, 2000)})` : ''}.`,
      },
      {
        type: 'image_url',
        image_url: {
          url: `data:${mimeType};base64,${image.toString('base64')}`,
        },
      },
    ];
    return this.callAi(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: contentParts },
      ],
      this.visionModel,
    );
  }

  private async callAi(
    messages: Array<Record<string, unknown>>,
    model: string,
  ): Promise<AIExtractionResult> {
    for (let attempt = 1; attempt <= MAX_AI_RETRIES; attempt++) {
      try {
        const res = await axios.post<{
          choices: Array<{ message: { content: string } }>;
          usage?: { total_tokens?: number };
        }>(
          'https://openrouter.ai/api/v1/chat/completions',
          { model, messages, temperature: 0 },
          {
            headers: {
              Authorization: `Bearer ${this.apiKey}`,
              'Content-Type': 'application/json',
            },
            timeout: 30_000,
          },
        );

        const content = res.data?.choices?.[0]?.message?.content ?? '';
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('No JSON in AI response');

        return {
          parsed: normalizeParsedImport(JSON.parse(jsonMatch[0])),
          model,
          tokensUsed: res.data?.usage?.total_tokens ?? undefined,
        };
      } catch (error) {
        const isRateLimit =
          axios.isAxiosError(error) && error.response?.status === 429;
        if (isRateLimit && attempt < MAX_AI_RETRIES) {
          const retryAfter: string | undefined = error.response?.headers?.[
            'retry-after'
          ] as string | undefined;
          const delay = retryAfter
            ? parseInt(retryAfter, 10) * 1000
            : Math.min(attempt * 5000, 15000);
          this.logger.warn(
            `OpenRouter rate limited (attempt ${attempt}/${MAX_AI_RETRIES}), retrying in ${delay}ms`,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
        throw error;
      }
    }
    throw new Error('OpenRouter retry exhausted');
  }
}
