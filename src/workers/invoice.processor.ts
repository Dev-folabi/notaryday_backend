import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { PrismaService } from '../config/prisma.service';
import { NotificationsService } from '../modules/notifications/notifications.service';
import { QUEUE_INVOICE } from '../queues/queue.constants';
import { ConfigService } from '@nestjs/config';
import PDFDocument from 'pdfkit';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { Prisma } from '../../generated/prisma';

type InvoiceWithJob = Prisma.InvoiceGetPayload<{ include: { job: true } }>;

@Processor(QUEUE_INVOICE)
export class InvoiceProcessor {
  private readonly logger = new Logger(InvoiceProcessor.name);

  private readonly s3Client: S3Client;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
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

      doc.text(`Subtotal: $${invoice.subtotal.toString()}`);
      doc.text(`Travel Fee: $${invoice.travel_fee.toString()}`);
      doc.fontSize(14).text(`Total Due: $${invoice.total.toString()}`);

      doc.end();
    });
  }

  @Process('generate-pdf')
  async handleGeneratePdf(job: Job<{ invoiceId: string; userId: string }>) {
    const { invoiceId, userId } = job.data;
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { job: true },
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
