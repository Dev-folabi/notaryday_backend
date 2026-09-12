export type TransactionalProviderType = 'resend' | 'brevo';

export interface TransactionalSendOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface TransactionalSendResult {
  provider: TransactionalProviderType;
  messageId?: string;
}

export interface ProviderStatus {
  type: TransactionalProviderType;
  label: string;
  configured: boolean;
  fromEmail: string;
}

/**
 * Each transactional email provider adapter implements this interface.
 * The from address is resolved from env-level config via normalizeFromAddress.
 */
export interface TransactionalMailer {
  readonly provider: TransactionalProviderType;
  send(options: TransactionalSendOptions): Promise<TransactionalSendResult>;
  isConfigured(): boolean;
  getFromEmail(): string;
}
