import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '../config/prisma.service';
import { QUEUE_INVOICE } from '../queues/queue.constants';

/**
 * Self-healing for invoice delivery. Whenever generate-pdf / send-email work
 * is enqueued, the invoice is marked pdf_pending / email_pending and only
 * cleared once the worker confirms success. If Redis was down when the job was
 * added (so it never got queued) or a worker died mid-job, the flag stays set
 * and this cron re-enqueues the missing work. Live jobs are excluded to avoid
 * duplicate emails.
 */
@Injectable()
export class InvoiceRetryService {
  private readonly logger = new Logger(InvoiceRetryService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_INVOICE) private readonly invoiceQueue: Queue,
  ) {}

  @Cron('*/5 * * * *')
  async retryPendingDeliveries() {
    try {
      const pending = await this.prisma.invoice.findMany({
        where: {
          deleted_at: null,
          OR: [{ pdf_pending: true }, { email_pending: true }],
        },
        select: {
          id: true,
          user_id: true,
          pdf_pending: true,
          email_pending: true,
        },
      });
      if (pending.length === 0) return;

      const live = await this.liveInvoiceIds();
      if (!live) return; // queue unreachable — try again next tick

      let reenqueued = 0;
      for (const invoice of pending) {
        if (invoice.pdf_pending && !live.has(invoice.id)) {
          try {
            await this.invoiceQueue.add('generate-pdf', {
              invoiceId: invoice.id,
              userId: invoice.user_id,
            });
            reenqueued++;
          } catch (err) {
            this.logger.warn(
              `Failed to re-enqueue PDF for invoice ${invoice.id}: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          }
        }
        if (invoice.email_pending && !live.has(invoice.id)) {
          try {
            await this.invoiceQueue.add('send-email', {
              invoiceId: invoice.id,
              userId: invoice.user_id,
            });
            reenqueued++;
          } catch (err) {
            this.logger.warn(
              `Failed to re-enqueue email for invoice ${invoice.id}: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          }
        }
      }

      if (reenqueued > 0) {
        this.logger.log(
          `Re-enqueued ${reenqueued} pending invoice job(s) after delivery gap`,
        );
      }
    } catch (err) {
      this.logger.error(
        'Invoice delivery retry scan failed',
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  /** Invoice ids that already have a live queue job (wait/delayed/active/paused). */
  private async liveInvoiceIds(): Promise<Set<string> | null> {
    try {
      const jobs = await Promise.race([
        this.invoiceQueue.getJobs(['waiting', 'delayed', 'active', 'paused']),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('queue state timed out after 5s')),
            5000,
          ),
        ),
      ]);
      const ids = new Set<string>();
      for (const job of jobs) {
        const invoiceId = (job.data as { invoiceId?: string })?.invoiceId;
        if (invoiceId) ids.add(invoiceId);
      }
      return ids;
    } catch (err) {
      this.logger.warn(
        `Invoice retry scan skipped — queue state unavailable: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }
}
