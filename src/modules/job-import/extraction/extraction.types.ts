import { SigningType } from '../../../../generated/prisma';

/**
 * Canonical, validated extraction output. All fields optional; null means
 * "not extractable". Mirrors the JobImport.parsed_* columns.
 */
export interface ParsedImport {
  address?: string | null;
  appointment_time?: string | null; // ISO 8601
  signing_type?: SigningType | null;
  fee?: number | null;
  platform_fee?: number | null;
  client_name?: string | null;
  client_phone?: string | null;
  client_email?: string | null;
  platform_name?: string | null;
  notes?: string | null;
}

/** Per-field extraction result with a 0..1 confidence score. */
export interface FieldResult<T> {
  value: T | null;
  confidence: number;
}

/** Result of the deterministic rule parser. */
export interface RuleExtractionResult {
  parsed: ParsedImport;
  /** Overall weighted confidence 0..1 — drives whether AI is needed. */
  confidence: number;
  /** Per-field confidence, used by the hybrid merge. */
  fieldConfidence: Partial<Record<keyof ParsedImport, number>>;
}

/** Outcome of the full pipeline (rule alone, or rule+AI hybrid). */
export interface ExtractionOutcome {
  parsed: ParsedImport;
  /** 'rule' = deterministic only; 'hybrid' = AI filled low-confidence fields. */
  method: 'rule' | 'hybrid';
  confidence: number;
  ocrText?: string;
  aiModel?: string;
  aiTokensUsed?: number;
}

/** Raw result from an AI provider before validation/normalization. */
export interface AIExtractionResult {
  parsed: Partial<ParsedImport>;
  model: string;
  tokensUsed?: number;
}

/** AI provider contract — swap in a self-hosted VLM later behind this. */
export interface AIExtractor {
  readonly name: string;
  extractFromText(text: string): Promise<AIExtractionResult>;
  extractFromImage(
    image: Buffer,
    mimeType: string,
    ocrText?: string,
  ): Promise<AIExtractionResult>;
}
