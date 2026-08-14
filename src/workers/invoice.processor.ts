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

type InvoiceWithJob = Prisma.InvoiceGetPayload<{
  include: { job: true; user: { include: { settings: true } } };
}>;

@Processor(QUEUE_INVOICE)
export class InvoiceProcessor {
  private readonly logger = new Logger(InvoiceProcessor.name);

  private readonly s3Client: S3Client;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly userSettings: UserSettingsService,
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
  }

  private async generateInvoiceBuffer(
    invoice: InvoiceWithJob,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50 });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.fontSize(20).text('INVOICE', { align: 'right' });
      doc
        .fontSize(10)
        .text(`Invoice Number: ${invoice.invoice_number.toString()}`, {
          align: 'right',
        });
      doc.text(`Date: ${new Date().toLocaleDateString()}`, { align: 'right' });
      doc.moveDown();

      doc.fontSize(14).text('Billed To:');
      doc.fontSize(12).text(invoice.recipient_name || invoice.recipient_email);
      if (invoice.recipient_name) {
        doc.text(invoice.recipient_email);
      }
      doc.moveDown(2);

      doc.fontSize(12).text('Job Details:');
      doc.text(`Service: ${invoice.job.signing_type.replace('_', ' ')}`);
      doc.text(`Location: ${invoice.job.address}`);
      doc.text(
        `Appointment: ${invoice.job.appointment_time.toLocaleDateString()}`,
      );
      doc.moveDown(2);

      doc.text(`Subtotal: $${Number(invoice.total).toFixed(2)}`);
      doc.text(`Tax: $0.00`);
      doc.fontSize(14).text(`Total Due: $${Number(invoice.total).toFixed(2)}`);

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
        doc.moveDown(2);
        doc.fontSize(12).text('Payment Details:');
        doc.fontSize(10);
        for (const line of paymentLines) doc.text(line);
      }

      if (invoice.note_to_client) {
        doc.moveDown(2);
        doc.fontSize(10).text('Note:');
        doc.fontSize(10).text(invoice.note_to_client);
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
      const pdfUrl = `${r2PublicDomain}/${objectKey}`;

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
      await this.notifications.sendEmail({
        to: invoice.recipient_email,
        subject: `Invoice ${invoice.invoice_number} from ${invoice.user.full_name}`,
        html: `
          <div style="font-family:Inter,sans-serif;max-width:600px;margin:0 auto">
            <h2 style="color:#0F2C4E">Invoice ${invoice.invoice_number.toString()}</h2>
            <p>Amount due: <strong>$${invoice.total.toString()}</strong></p>
            <p>Service: ${invoice.job.signing_type.replace('_', ' ')} at ${invoice.job.address}</p>
            <p>Date: ${invoice.job.appointment_time.toLocaleDateString()}</p>
            ${
              invoice.pdf_url
                ? `<p style="margin-top:16px"><a href="${invoice.pdf_url}" style="background:#0F2C4E;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;display:inline-block">View / download invoice PDF</a></p>`
                : ''
            }
            <hr style="border:none;border-top:1px solid #E2E8F0;margin:20px 0">
            <p style="font-size:12px;color:#64748B">Payment details are included on the invoice PDF.</p>
          </div>
        `,
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
