import { Injectable, NotFoundException } from '@nestjs/common';
import { EmailTemplate } from '../../../generated/prisma';
import { PrismaService } from '../../config/prisma.service';
import {
  looksLikeHtml,
  textToHtml,
} from '../../common/email/template-text.util';
import {
  CreateEmailTemplateDto,
  UpdateEmailTemplateDto,
} from './dto/email-template.dto';

const DEFAULT_TEMPLATES = [
  {
    type: 'appointment_reminder',
    name: 'Appointment Reminder',
    subject: 'Reminder: Your signing appointment is coming up',
    body: `Hi {{client_name}},

This is a reminder that your signing appointment is scheduled for {{appointment_time}} at {{address}}.

Your notary, {{notary_name}}, will arrive on time. Please have your ID ready.

See you soon!`,
  },
  {
    type: 'invoice',
    name: 'Invoice',
    subject: 'Invoice {{invoice_number}} from {{notary_name}}',
    body: `Hi {{client_name}},

Please find your invoice below:

Invoice: {{invoice_number}}
Amount: \${{total}}
Service: {{service_type}} at {{address}}
Date: {{date}}

Payment details:
{{payment_info}}

Thank you for choosing {{notary_name}}.`,
  },
  {
    type: 'booking_confirmation',
    name: 'Booking Confirmation',
    subject: 'Your appointment with {{notary_name}} is confirmed',
    body: `Hi {{client_name}},

Your signing appointment has been confirmed:

Date: {{date}}
Time: {{appointment_time}}
Address: {{address}}
Service: {{service_type}}

If you need to reschedule, please contact {{notary_name}} directly.`,
  },
  {
    type: 'booking_declined',
    name: 'Booking Declined',
    subject: 'Regarding your booking request with {{notary_name}}',
    body: `Hi {{client_name}},

Unfortunately, {{notary_name}} is unavailable at the requested time.

{{#alternative_times}}
Here are some alternative times that may work:

{{alternative_times}}
{{/alternative_times}}

Please feel free to book again for a different time.`,
  },
  {
    type: 'client_eta',
    name: 'Client ETA',
    subject: 'Your notary is on the way',
    body: `Hi {{client_name}},

Your notary, {{notary_name}}, is heading to you and will arrive at approximately {{eta_time}}.

Please have your ID ready for the signing.`,
  },
];

@Injectable()
export class EmailTemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Get all templates for a user (creates defaults if none exist) */
  async findAll(userId: string) {
    let templates = await this.prisma.emailTemplate.findMany({
      where: { user_id: userId },
    });
    if (templates.length === 0) {
      templates = await this.seedDefaults(userId);
    }
    return templates;
  }

  async findByType(userId: string, type: string) {
    let template = await this.prisma.emailTemplate.findUnique({
      where: { user_id_type: { user_id: userId, type } },
    });
    if (!template) {
      await this.seedDefaults(userId);
      template = await this.prisma.emailTemplate.findUnique({
        where: { user_id_type: { user_id: userId, type } },
      });
    }
    return template;
  }

  async create(userId: string, dto: CreateEmailTemplateDto) {
    return this.prisma.emailTemplate.create({
      data: { user_id: userId, ...dto },
    });
  }

  async update(userId: string, id: string, dto: UpdateEmailTemplateDto) {
    const template = await this.prisma.emailTemplate.findFirst({
      where: { id, user_id: userId },
    });
    if (!template) throw new NotFoundException('Template not found');
    return this.prisma.emailTemplate.update({ where: { id }, data: dto });
  }

  async resetToDefault(userId: string, type: string) {
    const def = DEFAULT_TEMPLATES.find((t) => t.type === type);
    if (!def) throw new NotFoundException('Unknown template type');
    return this.prisma.emailTemplate.upsert({
      where: { user_id_type: { user_id: userId, type } },
      create: { user_id: userId, ...def },
      update: { subject: def.subject, body: def.body, name: def.name },
    });
  }

  /** Render a template with variables. Text bodies are converted to HTML;
   *  legacy HTML bodies (already stored as markup) pass through unchanged. */
  render(
    template: { subject: string; body: string },
    vars: Record<string, string>,
  ): { subject: string; body: string } {
    let subject = template.subject;
    let body = looksLikeHtml(template.body)
      ? template.body
      : textToHtml(template.body);
    for (const [key, value] of Object.entries(vars)) {
      const re = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
      subject = subject.replace(re, value);
      body = body.replace(re, value);

      const secRe = new RegExp(
        `\\{\\{#${key}\\}\\}([\\s\\S]*?)\\{\\{/${key}\\}\\}`,
        'g',
      );
      body = body.replace(secRe, value.trim() ? '$1' : '');
    }
    return { subject, body };
  }

  private async seedDefaults(userId: string): Promise<EmailTemplate[]> {
    const templates: EmailTemplate[] = [];
    for (const def of DEFAULT_TEMPLATES) {
      const t = await this.prisma.emailTemplate.upsert({
        where: { user_id_type: { user_id: userId, type: def.type } },
        create: { user_id: userId, ...def },
        update: {},
      });
      templates.push(t);
    }
    return templates;
  }
}
