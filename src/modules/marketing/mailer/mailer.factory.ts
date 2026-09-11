import { Injectable, BadRequestException } from '@nestjs/common';
import { ProviderType } from '../marketing.constants';
import { MailerProvider } from './mailer-provider.interface';
import { ResendMailer } from './resend.mailer';
import { BrevoMailer } from './brevo.mailer';
import { SmtpMailer } from './smtp.mailer';

export type ProviderCredentials = Record<string, string>;

/**
 * Builds MailerProvider adapters from decrypted credentials.
 * Stateless — call build() per send or cache per provider document.
 */
@Injectable()
export class MailerFactory {
  build(type: ProviderType, credentials: ProviderCredentials): MailerProvider {
    switch (type) {
      case 'resend': {
        if (!credentials.apiKey) {
          throw new BadRequestException('Resend provider requires apiKey');
        }
        return new ResendMailer(credentials.apiKey);
      }
      case 'brevo': {
        if (!credentials.apiKey) {
          throw new BadRequestException('Brevo provider requires apiKey');
        }
        return new BrevoMailer(credentials.apiKey);
      }
      case 'zoho': {
        if (!credentials.user || !credentials.password) {
          throw new BadRequestException('Zoho provider requires user/password');
        }
        return new SmtpMailer('zoho', {
          user: credentials.user,
          password: credentials.password,
          host: credentials.host,
          port: credentials.port ? Number(credentials.port) : undefined,
        });
      }
      case 'gmail': {
        if (!credentials.user || !credentials.appPassword) {
          throw new BadRequestException(
            'Gmail provider requires user/appPassword',
          );
        }
        return new SmtpMailer('gmail', {
          user: credentials.user,
          password: credentials.appPassword,
          host: credentials.host,
          port: credentials.port ? Number(credentials.port) : undefined,
        });
      }
      default:
        throw new BadRequestException(`Unknown provider type: ${String(type)}`);
    }
  }
}
