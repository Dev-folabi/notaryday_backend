import { InjectQueue } from '@nestjs/bull';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Queue } from 'bull';
import { PrismaService } from '../config/prisma.service';
import { QUEUE_INVOICE } from '../queues/queue.constants';

@Injectable()
export class InvoiceRetryCronService {
  private readonly logger = new Logger(InvoiceRetryCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_INVOICE) private readonly invoiceQueue: Queue,
  ) {}

  @Cron('*/15 * * * *')
  async retryPendingEmails() {
    const retryBefore = new Date(Date.now() - 15 * 60_000);
    const invoices = await this.prisma.invoice.findMany({
      where: {
        deleted_at: null,
        email_pending: true,
        email_attempts: { gte: 1, lt: 3 },
        email_last_error: { not: null },
        email_last_attempt_at: { lte: retryBefore },
      },
      select: { id: true, user_id: true, email_attempts: true },
    });

    for (const invoice of invoices) {
      const attempt = invoice.email_attempts + 1;
      try {
        await this.invoiceQueue.add(
          'send-email',
          { invoiceId: invoice.id, userId: invoice.user_id, attempt },
          {
            jobId: `invoice-email-${invoice.id}-${attempt}`,
            attempts: 1,
            removeOnComplete: true,
            removeOnFail: true,
          },
        );
      } catch (error) {
        this.logger.error(
          `Failed to enqueue invoice ${invoice.id} attempt ${attempt}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
  }
}
