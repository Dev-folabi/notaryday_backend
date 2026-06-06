import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '../../config/prisma.service';
import { UserSettingsService } from '../users/user-settings.service';
import { QUEUE_INVOICE } from '../../queues/queue.constants';
import { JobStatus } from '../../../generated/prisma';

@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userSettings: UserSettingsService,
    @InjectQueue(QUEUE_INVOICE) private readonly invoiceQueue: Queue,
  ) {}

  /** Generate invoice for a completed job — queues PDF generation */
  async generate(userId: string, jobId: string) {
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, user_id: userId, deleted_at: null },
    });
    if (!job) throw new NotFoundException('Job not found');
    if (job.status !== JobStatus.COMPLETE)
      throw new BadRequestException('Job must be complete to generate invoice');

    // Check if invoice already exists
    const existing = await this.prisma.invoice.findUnique({
      where: { job_id: jobId },
    });
    if (existing) return existing;

    // Get next invoice number
    const year = new Date().getFullYear();
    const lastInvoice = await this.prisma.invoice.findFirst({
      where: { user_id: userId, invoice_number: { startsWith: `INV-${year}` } },
      orderBy: { invoice_number: 'desc' },
    });
    const seq = lastInvoice
      ? parseInt(lastInvoice.invoice_number.split('-')[2]) + 1
      : 1;
    const invoiceNumber = `INV-${year}-${String(seq).padStart(4, '0')}`;

    const recipientEmail = job.client_email ?? job.platform_name ?? '';
    const subtotal = Number(job.fee);
    const travelFee = Number(job.mileage_cost ?? 0);
    const total = subtotal + travelFee;

    const invoice = await this.prisma.invoice.create({
      data: {
        user_id: userId,
        job_id: jobId,
        invoice_number: invoiceNumber,
        recipient_email: recipientEmail,
        recipient_name: job.client_name,
        subtotal,
        travel_fee: travelFee,
        total,
      },
    });

    // Queue PDF generation + email sending
    await this.invoiceQueue.add('generate-pdf', {
      invoiceId: invoice.id,
      userId,
    });

    return invoice;
  }

  async findAll(userId: string, filters?: { is_paid?: boolean }) {
    const where: any = { user_id: userId, deleted_at: null };
    if (filters?.is_paid !== undefined) where.is_paid = filters.is_paid;
    return this.prisma.invoice.findMany({
      where,
      orderBy: { created_at: 'desc' },
      include: {
        job: {
          select: { address: true, signing_type: true, appointment_time: true },
        },
      },
    });
  }

  async findOne(userId: string, id: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, user_id: userId, deleted_at: null },
      include: { job: true },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return invoice;
  }

  async markPaid(userId: string, id: string, paymentMethod?: string) {
    const invoice = await this.findOne(userId, id);
    if (invoice.is_paid) throw new BadRequestException('Invoice already paid');

    return this.prisma.invoice.update({
      where: { id },
      data: {
        is_paid: true,
        paid_at: new Date(),
        payment_method_used: paymentMethod,
      },
    });
  }

  /** Queue email send for an existing invoice */
  async send(userId: string, id: string, recipientEmail?: string) {
    const invoice = await this.findOne(userId, id);

    if (!invoice) throw new NotFoundException('Invoice not found');

    if (recipientEmail) {
      await this.prisma.invoice.update({
        where: { id },
        data: { recipient_email: recipientEmail },
      });
    }
    await this.invoiceQueue.add('send-email', { invoiceId: id, userId });
    await this.prisma.invoice.update({
      where: { id },
      data: { sent_at: new Date() },
    });
    return { sent: true };
  }
}
