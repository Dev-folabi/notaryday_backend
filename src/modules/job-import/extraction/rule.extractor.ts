import { Injectable } from '@nestjs/common';
import { ParsedImport, RuleExtractionResult } from './extraction.types';
import { parseAddress } from '../parsing/address.parser';
import { parseDateTime } from '../parsing/datetime.parser';
import { parseFee, parsePlatformFee } from '../parsing/fee.parser';
import { parseEmail, parsePhone } from '../parsing/contact.parser';
import { parseSigningType } from '../parsing/signing-type.parser';
import {
  parseClientName,
  parseNotes,
  parsePlatformName,
} from '../parsing/meta.parser';

/**
 * Weights for the overall confidence score. Required fields (address, time,
 * signing type, fee) dominate; optional fields (client/platform/notes) are
 * low weight so a missing optional field alone NEVER drops confidence below
 * the AI threshold.
 */
const WEIGHTS: Record<keyof ParsedImport, number> = {
  address: 0.3,
  appointment_time: 0.3,
  signing_type: 0.15,
  fee: 0.1,
  platform_fee: 0.05,
  client_name: 0.03,
  client_phone: 0.02,
  client_email: 0.02,
  platform_name: 0.02,
  notes: 0.01,
};

@Injectable()
export class RuleExtractor {
  extract(text: string): RuleExtractionResult {
    const source = this.prepare(text);

    const fields = {
      address: parseAddress(source),
      appointment_time: parseDateTime(source),
      signing_type: parseSigningType(source),
      fee: parseFee(source),
      platform_fee: parsePlatformFee(source),
      client_name: parseClientName(source),
      client_phone: parsePhone(source),
      client_email: parseEmail(source),
      platform_name: parsePlatformName(source),
      notes: parseNotes(source),
    };

    const parsed: ParsedImport = {};
    const fieldConfidence: RuleExtractionResult['fieldConfidence'] = {};
    for (const key of Object.keys(fields) as Array<keyof typeof fields>) {
      (parsed as Record<string, unknown>)[key] = fields[key].value;
      fieldConfidence[key] = fields[key].confidence;
    }

    // Confidence = value * weight, summed. A missing field contributes 0.
    let confidence = 0;
    for (const field of Object.keys(WEIGHTS) as Array<keyof ParsedImport>) {
      const value = parsed[field];
      if (value == null) continue;
      confidence += (fieldConfidence[field] ?? 0.5) * WEIGHTS[field];
    }

    return { parsed, confidence, fieldConfidence };
  }

  /** Normalize input text for parsing (collapse whitespace per line). */
  private prepare(text: string): string {
    return text
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
}
