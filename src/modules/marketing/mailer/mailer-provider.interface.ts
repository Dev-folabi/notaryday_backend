/**
 * Common interface every marketing email provider adapter implements.
 * Used by the API (test sends) and the marketing worker (bulk sends).
 */

export interface MailerSendOptions {
  to: string;
  subject: string;
  html?: string;
  text?: string;
  fromName: string;
  fromEmail: string;
  replyTo?: string;
  headers?: Record<string, string>;
  /** Provider-side tags (Resend tags / Brevo tags). */
  tags?: string[];
}

export interface MailerSendResult {
  /** Provider message id, used to correlate delivery webhooks. */
  providerMessageId?: string;
  raw?: unknown;
}

export interface MailerProvider {
  readonly type: string;
  send(options: MailerSendOptions): Promise<MailerSendResult>;
}
