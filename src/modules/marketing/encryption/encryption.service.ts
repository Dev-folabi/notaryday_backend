import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from 'node:crypto';

const ALGO = 'aes-256-gcm';
const SALT = 'notaryday-marketing-credentials';

/**
 * AES-256-GCM encryption for provider credentials stored in MongoDB.
 * Key is derived from MARKETING_CREDENTIALS_KEY via scrypt.
 * Ciphertext format: base64(iv(12) | authTag(16) | ciphertext)
 */
@Injectable()
export class EncryptionService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    const secret = config.get<string>('marketing.credentialsKey', {
      infer: true,
    });
    if (!secret || secret.length < 32) {
      throw new Error(
        'MARKETING_CREDENTIALS_KEY must be set (min 32 chars) for marketing module',
      );
    }
    this.key = scryptSync(secret, SALT, 32);
  }

  encrypt(plain: unknown): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGO, this.key, iv);
    const json = JSON.stringify(plain);
    const ciphertext = Buffer.concat([
      cipher.update(json, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, ciphertext]).toString('base64');
  }

  decrypt<T = Record<string, string>>(payload: string): T {
    const raw = Buffer.from(payload, 'base64');
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ciphertext = raw.subarray(28);
    const decipher = createDecipheriv(ALGO, this.key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');
    return JSON.parse(plain) as T;
  }
}
