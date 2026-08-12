import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '../../config/prisma.service';
import { UserSettingsService } from '../users/user-settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { QUEUE_INVOICE } from '../../queues/queue.constants';
import { UpdateInvoiceDto } from './dto/invoice.dto';
import { JobStatus, Prisma } from '../../../generated/prisma';

@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly userSettings: UserSettingsService,
    private readonly notifications: NotificationsService,
    @InjectQueue(QUEUE_INVOICE) private readonly invoiceQueue: Queue,
  ) {}

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

    const recipientEmail = job.client_email ?? job.platform_name ?? '';
    const recipientName = job.client_name ?? job.platform_name ?? null;

    if (existing) {
      await this.prisma.invoice.update({
        where: { id: existing.id },
        data: {
          recipient_email: recipientEmail || existing.recipient_email,
          recipient_name: recipientName ?? existing.recipient_name,
        },
      });
      if (!existing.pdf_url && !existing.pdf_pending) {
        await this.prisma.invoice.update({
          where: { id: existing.id },
          data: { pdf_pending: true },
        });
        await this.enqueue('generate-pdf', {
          invoiceId: existing.id,
          userId,
        });
      }
      return this.prisma.invoice.findFirst({
        where: { id: existing.id },
        include: {
          job: {
            select: {
              address: true,
              signing_type: true,
              appointment_time: true,
              fee: true,
              platform_fee: true,
              net_earnings: true,
              mileage_cost: true,
              client_name: true,
            },
          },
        },
      });
    }

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

    const subtotal = Number(job.fee);
    const travelFee = Number(job.mileage_cost ?? 0);
    const total = subtotal + travelFee;

    const invoice = await this.prisma.invoice.create({
      data: {
        user_id: userId,
        job_id: jobId,
        invoice_number: invoiceNumber,
        recipient_email: recipientEmail,
        recipient_name: recipientName,
        subtotal,
        travel_fee: travelFee,
        total,
      },
    });

    await this.prisma.invoice.update({
      where: { id: invoice.id },
      data: { pdf_pending: true },
    });
    await this.enqueue('generate-pdf', { invoiceId: invoice.id, userId });

    return this.prisma.invoice.findFirst({
      where: { id: invoice.id },
      include: {
        job: {
          select: {
            address: true,
            signing_type: true,
            appointment_time: true,
            fee: true,
            platform_fee: true,
            net_earnings: true,
            mileage_cost: true,
            client_name: true,
          },
        },
      },
    });
  }

  /** Best-effort enqueue that never blocks or fails the request on a slow/down
   *  Redis. If the add is lost the task is retried manually, not by cron. */
  private async enqueue(name: string, data: Record<string, unknown>) {
    await Promise.race([
      this.invoiceQueue.add(name, data),
      new Promise<void>((resolve) => setTimeout(resolve, 2000)),
    ]).catch((err: unknown) => {
      this.logger.warn(
        `Invoice queue failed for ${name} (${String(
          (data.invoiceId as string) ?? (data.jobId as string) ?? 'unknown',
        )}): ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }

  async findAll(userId: string, filters?: { is_paid?: boolean }) {
    const where: Prisma.InvoiceWhereInput = {
      user_id: userId,
      deleted_at: null,
    };
    if (filters?.is_paid !== undefined) where.is_paid = filters.is_paid;
    return this.prisma.invoice.findMany({
      where,
      orderBy: { created_at: 'desc' },
      include: {
        job: {
          select: {
            address: true,
            signing_type: true,
            appointment_time: true,
            fee: true,
            platform_fee: true,
            net_earnings: true,
            mileage_cost: true,
            client_name: true,
          },
        },
      },
    });
  }

  /** Invoice summary stats — mirrors the frontend statusOf logic */
  async findStats(userId: string) {
    const rows = await this.prisma.invoice.findMany({
      where: { user_id: userId, deleted_at: null },
      select: {
        total: true,
        travel_fee: true,
        is_paid: true,
        sent_at: true,
        job: { select: { fee: true } },
      },
    });

    const now = Date.now();
    const stats = {
      billed: 0,
      paid: 0,
      outstanding: 0,
      overdue: 0,
      // Current (live) job fees for invoiced jobs — invoices store a snapshot
      // at generation time, so "earned" can diverge from "billed".
      earned: 0,
      // Travel/mileage fees captured on the invoices (portion of billed that is
      // not part of the job's base fee).
      travelFees: 0,
    };

    for (const row of rows) {
      const total = Number(row.total) || 0;
      stats.billed += total;
      stats.earned += Number(row.job?.fee ?? 0) || 0;
      stats.travelFees += Number(row.travel_fee ?? 0) || 0;
      if (row.is_paid) {
        stats.paid += total;
      } else {
        stats.outstanding += total;
        if (row.sent_at) {
          const days = (now - new Date(row.sent_at).getTime()) / 86_400_000;
          if (days > 30) stats.overdue += total;
        }
      }
    }

    return stats;
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

    const updated = await this.prisma.invoice.update({
      where: { id },
      data: {
        is_paid: true,
        paid_at: new Date(),
        payment_method_used: paymentMethod,
      },
    });

    await this.notifications
      .createNotification({
        userId,
        type: 'PAYMENT_RECEIVED',
        title: 'Payment received',
        body: `Invoice ${invoice.invoice_number} for $${Number(invoice.total).toFixed(2)} marked as paid${paymentMethod ? ` via ${paymentMethod}` : ''}.`,
        jobId: invoice.job_id,
        actionUrl: `/invoices`,
      })
      .catch(() => {});

    return updated;
  }

  /** Queue email send for an existing invoice (only on manual "Send"/"Resend" —
   *  never automatic, and never re-enqueued by a cron afterwards). */
  async send(userId: string, id: string, recipientEmail?: string) {
    const invoice = await this.findOne(userId, id);

    const email = recipientEmail?.trim() || invoice.recipient_email?.trim();
    if (!email || !email.includes('@')) {
      throw new BadRequestException(
        'A valid recipient email is required to send the invoice',
      );
    }

    await this.prisma.invoice.update({
      where: { id },
      data: { recipient_email: email, email_pending: true },
    });

    await this.enqueue('send-email', { invoiceId: id, userId });
    return { queued: true };
  }

  /** Auto-sync invoice amounts and recipient details to a job's current state.
   *  Works for any unpaid invoice (draft or already sent) — only paid invoices
   *  are locked and keep the amount billed at generation time. */
  async syncDraftFromJob(
    userId: string,
    jobId: string,
    job: {
      fee: number | null;
      mileage_cost: number | null;
      client_name?: string | null;
      client_email?: string | null;
    },
  ) {
    const invoice = await this.findByJob(userId, jobId);
    if (!invoice) return;
    // Paid invoices are locked — sent/unpaid ones stay in sync.
    if (invoice.is_paid) return;

    const subtotal = Number(job.fee ?? 0);
    const travelFee = Number(job.mileage_cost ?? 0);
    const total = subtotal + travelFee;
    const recipientName =
      job.client_name !== undefined ? job.client_name : invoice.recipient_name;
    const recipientEmail =
      job.client_email !== undefined && job.client_email !== null
        ? job.client_email
        : invoice.recipient_email;

    if (
      Number(invoice.subtotal) === subtotal &&
      Number(invoice.travel_fee) === travelFee &&
      Number(invoice.total) === total &&
      invoice.recipient_name === recipientName &&
      invoice.recipient_email === recipientEmail
    ) {
      return;
    }

    const data: Prisma.InvoiceUpdateInput = {
      subtotal,
      travel_fee: travelFee,
      total,
      ...(job.client_name !== undefined && { recipient_name: job.client_name }),
      ...(job.client_email !== undefined &&
        job.client_email !== null && { recipient_email: job.client_email }),
    };

    await this.prisma.invoice.update({
      where: { id: invoice.id },
      data,
    });
    await this.prisma.invoice.update({
      where: { id: invoice.id },
      data: { pdf_pending: true },
    });
    await this.enqueue('generate-pdf', {
      invoiceId: invoice.id,
      userId,
      reason: 'fee-edit-sync',
    });
  }

  private async findByJob(userId: string, jobId: string) {
    return this.prisma.invoice.findFirst({
      where: { job_id: jobId, user_id: userId, deleted_at: null },
    });
  }

  /** Update editable fields on an existing invoice */
  async update(userId: string, id: string, dto: UpdateInvoiceDto) {
    const invoice = await this.findOne(userId, id);

    // Only paid invoices lock the amount — sent/unpaid invoices can still be
    // edited (and auto-synced from the job fee).
    if (invoice.is_paid && dto.final_fee !== undefined) {
      throw new BadRequestException('Paid invoices cannot change the amount');
    }

    const data: Prisma.InvoiceUpdateInput = {};
    if (dto.recipient_email !== undefined) {
      data.recipient_email = dto.recipient_email;
    }
    if (dto.recipient_name !== undefined) {
      data.recipient_name = dto.recipient_name;
    }
    if (dto.note_to_client !== undefined) {
      data.note_to_client = dto.note_to_client;
    }
    if (dto.final_fee !== undefined) {
      const finalFee = Number(dto.final_fee);
      data.subtotal = finalFee;
      data.travel_fee = 0;
      data.total = finalFee;
    }

    const updated = await this.prisma.invoice.update({
      where: { id: invoice.id },
      data,
    });

    await this.prisma.invoice.update({
      where: { id: invoice.id },
      data: { pdf_pending: true },
    });
    await this.enqueue('generate-pdf', {
      invoiceId: invoice.id,
      userId,
      reason: 'updated',
    });

    return updated;
  }
}
