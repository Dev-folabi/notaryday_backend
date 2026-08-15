import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { PrismaService } from '../config/prisma.service';
import { NotificationsService } from '../modules/notifications/notifications.service';
import { UserSettingsService } from '../modules/users/user-settings.service';
import { QUEUE_INVOICE } from '../queues/queue.constants';
import { ConfigService } from '@nestjs/config';
import PDFDocument from 'pdfkit';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { Prisma } from '../../generated/prisma';
import { getLocalEmailAssets } from '../common/email/email-assets';
import { EmailRendererService } from '../common/email/email-renderer.service';
import { EmailTemplatesService } from '../modules/email-templates/email-templates.service';

function fmtInTz(
  date: Date,
  timezone?: string | null,
  opts: { dateOnly?: boolean } = {},
): string {
  try {
    const abbr = timezone
      ? (new Intl.DateTimeFormat('en-US', {
          timeZone: timezone,
          timeZoneName: 'short',
        })
          .formatToParts(date)
          .find((p) => p.type === 'timeZoneName')?.value ?? null)
      : null;
    const formatted = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone ?? undefined,
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      ...(opts.dateOnly ? {} : { hour: 'numeric', minute: '2-digit' }),
    }).format(date);
    return abbr && !opts.dateOnly ? `${formatted} (${abbr})` : formatted;
  } catch {
    return date.toLocaleString();
  }
}

type InvoiceWithJob = Prisma.InvoiceGetPayload<{
  include: { job: true; user: { include: { settings: true } } };
}>;

@Processor(QUEUE_INVOICE)
export class InvoiceProcessor {
  private readonly logger = new Logger(InvoiceProcessor.name);

  private readonly s3Client: S3Client;
  private readonly emailAssets: ReturnType<typeof getLocalEmailAssets>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly userSettings: UserSettingsService,
    private readonly emailRenderer: EmailRendererService,
    private readonly emailTemplates: EmailTemplatesService,
    private readonly config: ConfigService,
  ) {
    const r2 = this.config.get<{
      accountId: string;
      accessKeyId: string;
      secretAccessKey: string;
      bucketName: string;
    }>('r2');

    this.s3Client = new S3Client({
      region: 'auto',
      endpoint: `https://${r2?.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: r2?.accessKeyId ?? '',
        secretAccessKey: r2?.secretAccessKey ?? '',
      },
    });
    this.emailAssets = getLocalEmailAssets();
  }

  private async generateInvoiceBuffer(
    invoice: InvoiceWithJob,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 42, size: 'LETTER' });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const pageWidth =
        doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const navy = '#0F2C4E';
      const slate = '#475569';
      const slate2 = '#64748B';
      const border = '#E2E8F0';
      const bg = '#F8FAFC';
      const notary = invoice.user;
      const notaryName = notary.full_name ?? notary.username;
      const invoiceTotal = Number(invoice.total);
      const travelFee = Number(invoice.job.mileage_cost ?? 0);
      const signingFee = invoiceTotal - travelFee;
      const settings = invoice.user.settings;
      const timezone = settings?.timezone ?? null;
      const state = settings?.state || null;
      const dueDays = settings?.invoice_due_days ?? 0;
      const clientPhone = invoice.job.client_phone ?? null;
      const durationMins = invoice.job.signing_duration_mins;
      const drawLabel = (
        label: string,
        value: string,
        x: number,
        y: number,
        width: number,
      ) => {
        doc
          .font('Helvetica')
          .fontSize(8)
          .fillColor(slate2)
          .text(label.toUpperCase(), x, y, { width });
        doc
          .font('Helvetica-Bold')
          .fontSize(10)
          .fillColor(navy)
          .text(value, x, y + 12, { width });
      };

      doc.save().rect(0, 0, doc.page.width, 112).fill(navy).restore();
      if (this.emailAssets.original) {
        try {
          doc.image(this.emailAssets.original, doc.page.margins.left, 27, {
            width: 170,
          });
        } catch {
          doc
            .font('Helvetica-Bold')
            .fontSize(22)
            .fillColor('#FFFFFF')
            .text('Notary Day', doc.page.margins.left, 38);
        }
      } else {
        doc
          .font('Helvetica-Bold')
          .fontSize(22)
          .fillColor('#FFFFFF')
          .text('Notary Day', doc.page.margins.left, 38);
      }
      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor('#CBD5E1')
        .text(`Invoice #${invoice.invoice_number}`, doc.page.margins.left, 73);
      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor('#CBD5E1')
        .text(
          fmtInTz(invoice.created_at, timezone, { dateOnly: true }),
          doc.page.margins.left,
          88,
        );
      doc
        .font('Helvetica-Bold')
        .fontSize(22)
        .fillColor('#FFFFFF')
        .text('INVOICE', doc.page.width - 170, 35, {
          width: 128,
          align: 'right',
        });
      doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor('#CBD5E1')
        .text('STATUS', doc.page.width - 170, 70, {
          width: 128,
          align: 'right',
        });
      doc
        .font('Helvetica-Bold')
        .fontSize(9)
        .fillColor('#FFFFFF')
        .text(invoice.is_paid ? 'PAID' : 'DUE', doc.page.width - 170, 82, {
          width: 128,
          align: 'right',
        });

      let y = 140;
      drawLabel(
        'From',
        notaryName,
        doc.page.margins.left,
        y,
        pageWidth / 2 - 16,
      );
      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor(slate2)
        .text(
          `${notary.email}\n${notary.phone ?? ''}${state ? `\n${state}` : ''}`,
          doc.page.margins.left,
          y + 30,
          { width: pageWidth / 2 - 16, lineGap: 3 },
        );
      drawLabel(
        'Bill to',
        invoice.recipient_name ?? invoice.recipient_email,
        doc.page.margins.left + pageWidth / 2,
        y,
        pageWidth / 2,
      );
      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor(slate2)
        .text(
          `${invoice.recipient_email}\n${invoice.job.address}${clientPhone ? `\n${clientPhone}` : ''}`,
          doc.page.margins.left + pageWidth / 2,
          y + 30,
          { width: pageWidth / 2, lineGap: 3 },
        );

      y += 92;
      doc
        .moveTo(doc.page.margins.left, y)
        .lineTo(doc.page.width - doc.page.margins.right, y)
        .strokeColor(border)
        .stroke();
      y += 22;
      doc
        .font('Helvetica-Bold')
        .fontSize(8)
        .fillColor(slate2)
        .text('DESCRIPTION', doc.page.margins.left, y);
      doc
        .font('Helvetica-Bold')
        .fontSize(8)
        .fillColor(slate2)
        .text('QTY', doc.page.width - 185, y, { width: 45, align: 'right' });
      doc
        .font('Helvetica-Bold')
        .fontSize(8)
        .fillColor(slate2)
        .text('AMOUNT', doc.page.width - 130, y, { width: 88, align: 'right' });
      y += 18;
      doc
        .moveTo(doc.page.margins.left, y)
        .lineTo(doc.page.width - doc.page.margins.right, y)
        .strokeColor(border)
        .stroke();
      y += 14;
      doc
        .font('Helvetica-Bold')
        .fontSize(10)
        .fillColor(navy)
        .text(
          invoice.job.signing_type.replace('_', ' '),
          doc.page.margins.left,
          y,
          { width: pageWidth - 180 },
        );
      doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor(slate2)
        .text(
          `${invoice.job.address} · ${fmtInTz(invoice.job.appointment_time, timezone)}${durationMins ? ` · ${durationMins} min` : ''}`,
          doc.page.margins.left,
          y + 14,
          { width: pageWidth - 180 },
        );
      doc
        .font('Helvetica')
        .fontSize(10)
        .fillColor(slate)
        .text('1', doc.page.width - 185, y, { width: 45, align: 'right' });
      doc
        .font('Helvetica-Bold')
        .fontSize(10)
        .fillColor(navy)
        .text(`$${signingFee.toFixed(2)}`, doc.page.width - 130, y, {
          width: 88,
          align: 'right',
        });
      y += 45;
      if (travelFee > 0) {
        doc
          .font('Helvetica')
          .fontSize(9)
          .fillColor(slate)
          .text('Travel / mileage', doc.page.margins.left, y);
        doc.text('1', doc.page.width - 185, y, { width: 45, align: 'right' });
        doc
          .font('Helvetica-Bold')
          .text(`$${travelFee.toFixed(2)}`, doc.page.width - 130, y, {
            width: 88,
            align: 'right',
          });
        y += 24;
      }
      doc
        .moveTo(doc.page.width - 220, y)
        .lineTo(doc.page.width - doc.page.margins.right, y)
        .strokeColor(border)
        .stroke();
      y += 16;
      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor(slate2)
        .text('Subtotal', doc.page.width - 180, y);
      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor(navy)
        .text(`$${invoiceTotal.toFixed(2)}`, doc.page.width - 100, y, {
          width: 58,
          align: 'right',
        });
      y += 17;
      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor(slate2)
        .text('Tax (0%)', doc.page.width - 180, y);
      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor(navy)
        .text('$0.00', doc.page.width - 100, y, { width: 58, align: 'right' });
      y += 30;
      doc.save().rect(0, y, doc.page.width, 54).fill(navy).restore();
      doc
        .font('Helvetica-Bold')
        .fontSize(11)
        .fillColor('#CBD5E1')
        .text('TOTAL DUE', doc.page.margins.left, y + 20);
      doc
        .font('Helvetica-Bold')
        .fontSize(20)
        .fillColor('#FFFFFF')
        .text(`$${invoiceTotal.toFixed(2)}`, doc.page.width - 180, y + 14, {
          width: 130,
          align: 'right',
        });
      y += 78;

      // Payment details from user settings
      const paymentInfo = invoice.user.settings?.payment_info;
      const paymentLines: string[] = [];
      if (typeof paymentInfo === 'string') {
        paymentLines.push(paymentInfo);
      } else if (
        typeof paymentInfo === 'object' &&
        paymentInfo !== null &&
        !Array.isArray(paymentInfo)
      ) {
        const info = paymentInfo as Record<string, unknown>;
        if (typeof info.bank_name === 'string' && info.bank_name) {
          const last4 =
            typeof info.account_last4 === 'string' && info.account_last4
              ? ` ending in ${info.account_last4}`
              : '';
          paymentLines.push(`${info.bank_name}${last4}`);
        }
        const labeled: [string, string][] = [
          ['zelle', 'Zelle'],
          ['venmo', 'Venmo'],
          ['paypal', 'PayPal'],
        ];
        for (const [key, label] of labeled) {
          const v = info[key];
          if (typeof v === 'string' && v) paymentLines.push(`${label}: ${v}`);
        }
        if (typeof info.routing_last4 === 'string' && info.routing_last4) {
          paymentLines.push(`Routing: ••••${info.routing_last4}`);
        }
        if (typeof info.other === 'string' && info.other) {
          paymentLines.push(info.other);
        }
      }

      if (paymentLines.length > 0) {
        doc
          .save()
          .roundedRect(doc.page.margins.left, y, pageWidth, 58, 5)
          .fill(bg)
          .restore();
        doc
          .font('Helvetica-Bold')
          .fontSize(9)
          .fillColor(navy)
          .text('PAYMENT DETAILS', doc.page.margins.left + 14, y + 12);
        doc
          .font('Helvetica')
          .fontSize(9)
          .fillColor(slate2)
          .text(paymentLines.join(' · '), doc.page.margins.left + 14, y + 28, {
            width: pageWidth - 28,
          });
        y += 76;
      }

      if (invoice.note_to_client) {
        doc
          .font('Helvetica-Bold')
          .fontSize(9)
          .fillColor(navy)
          .text('NOTE TO CLIENT', doc.page.margins.left, y);
        doc
          .font('Helvetica')
          .fontSize(9)
          .fillColor(slate2)
          .text(invoice.note_to_client, doc.page.margins.left, y + 14, {
            width: pageWidth,
          });
        y += 48;
      }

      doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor(slate2)
        .text(
          `Payment due ${dueDays > 0 ? `within ${dueDays} days` : 'upon receipt'}. Payment is made directly to the notary. Notary Day is not involved in the transaction.`,
          doc.page.margins.left,
          Math.min(y + 8, doc.page.height - 70),
          { width: pageWidth },
        );
      if (this.emailAssets.monochrome) {
        try {
          doc.image(
            this.emailAssets.monochrome,
            doc.page.margins.left,
            doc.page.height - 48,
            { width: 105 },
          );
        } catch {
          doc
            .font('Helvetica')
            .fontSize(8)
            .fillColor(slate2)
            .text(
              'Powered by Notary Day',
              doc.page.margins.left,
              doc.page.height - 35,
            );
        }
      }

      doc.end();
    });
  }

  @Process('generate-pdf')
  async handleGeneratePdf(
    job: Job<{ invoiceId: string; userId: string; reason?: string }>,
  ) {
    const { invoiceId, userId, reason } = job.data;
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { job: true, user: { include: { settings: true } } },
    });
    if (!invoice) return;

    try {
      const pdfBuffer = await this.generateInvoiceBuffer(invoice);
      const r2 = this.config.get<{ bucketName: string }>('r2');
      const objectKey = `invoices/${invoice.invoice_number}.pdf`;

      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: r2?.bucketName,
          Key: objectKey,
          Body: pdfBuffer,
          ContentType: 'application/pdf',
          ContentDisposition: `attachment; filename="${invoice.invoice_number}.pdf"`,
        }),
      );

      const r2PublicDomain =
        this.config.get<string>('R2_PUBLIC_DOMAIN') ||
        'https://assets.notaryday.app';
      const pdfUrl = `${r2PublicDomain}/${objectKey}?v=${Date.now()}`;

      await this.prisma.invoice.update({
        where: { id: invoiceId },
        data: { pdf_url: pdfUrl, pdf_pending: false },
      });

      this.logger.log(
        `Invoice ${invoice.invoice_number} PDF generated and uploaded`,
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to generate/upload PDF for ${invoice.invoice_number}: ${errorMessage}`,
      );
    }

    if (reason === 'updated') {
      this.logger.log(
        `Invoice ${invoice.invoice_number} PDF regenerated after edit`,
      );
      return;
    }

    await this.prisma.notification.create({
      data: {
        user_id: userId,
        type: 'INVOICE_SENT',
        title: 'Invoice ready',
        body: `Invoice ${invoice.invoice_number.toString()} for $${invoice.total.toString()} is ready to send.`,
        job_id: invoice.job_id,
        action_url: `/jobs/${invoice.job_id}`,
      },
    });
  }

  @Process('send-email')
  async handleSendEmail(job: Job<{ invoiceId: string; userId: string }>) {
    const { invoiceId } = job.data;
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { job: true, user: true },
    });
    if (!invoice || !invoice.recipient_email) return;
    const notificationConfig = await this.userSettings.getNotificationConfig(
      invoice.user_id,
    );
    if (!notificationConfig.prefs.client_invoice) {
      await this.prisma.invoice.update({
        where: { id: invoiceId },
        data: { email_pending: false },
      });
      return;
    }

    try {
      const timezone =
        (await this.userSettings.get(invoice.user_id)).timezone ?? null;
      const template = await this.emailTemplates.findByType(
        invoice.user_id,
        'invoice',
      );
      const custom =
        template && template.is_active
          ? this.emailTemplates.render(template, {
              client_name: invoice.recipient_name ?? 'there',
              invoice_number: invoice.invoice_number,
              total: Number(invoice.total).toFixed(2),
              service_type: invoice.job.signing_type.replace('_', ' '),
              address: invoice.job.address,
              date: fmtInTz(invoice.job.appointment_time, timezone, {
                dateOnly: true,
              }),
              notary_name: invoice.user.full_name ?? invoice.user.username,
              payment_info: 'Payment details are included on the invoice PDF.',
            })
          : null;
      const rendered = this.emailRenderer.render({
        title: `Invoice from ${invoice.user.full_name ?? invoice.user.username}`,
        subtitle: `Invoice #${invoice.invoice_number} · Powered by Notary Day`,
        greeting: custom
          ? undefined
          : `Hi ${invoice.recipient_name ?? 'there'},`,
        intro:
          custom?.body ??
          'Thank you for your signing appointment today. Please find your invoice below.',
        contentHtml: this.emailRenderer.detailBlock([
          [
            'Service',
            `${invoice.job.signing_type.replace('_', ' ')} · ${fmtInTz(invoice.job.appointment_time, timezone, { dateOnly: true })}`,
          ],
          ['Location', invoice.job.address],
          ['Invoice', invoice.invoice_number.toString()],
          ['Total due', `$${Number(invoice.total).toFixed(2)}`],
        ]),
        action: invoice.pdf_url
          ? { label: 'View / download invoice PDF', url: invoice.pdf_url }
          : undefined,
        footer:
          'Payment details are included on the invoice PDF. Payment is made directly to the notary.',
        plainText: `Invoice ${invoice.invoice_number} from ${invoice.user.full_name ?? invoice.user.username}. Total due: $${Number(invoice.total).toFixed(2)}. ${invoice.pdf_url ?? ''}`,
      });
      await this.notifications.sendEmail({
        to: invoice.recipient_email,
        subject:
          custom?.subject ??
          `Invoice ${invoice.invoice_number} from ${invoice.user.full_name}`,
        html: rendered.html,
        text: rendered.text,
      });
      this.logger.log(
        `Invoice ${invoice.invoice_number} emailed to ${invoice.recipient_email}`,
      );
      await this.prisma.invoice.update({
        where: { id: invoiceId },
        data: { email_pending: false, sent_at: new Date() },
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to send invoice email: ${errorMessage}`);
    }
  }
}
