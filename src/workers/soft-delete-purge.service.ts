import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../config/prisma.service';

@Injectable()
export class SoftDeletePurgeService {
  private readonly logger = new Logger(SoftDeletePurgeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  @Cron('30 3 * * *')
  async purge() {
    const retentionDays =
      this.config.get<number>('SOFT_DELETE_RETENTION_DAYS') ?? 90;
    const cutoff = new Date(Date.now() - retentionDays * 86_400_000);
    const where = { deleted_at: { lt: cutoff } };

    const operations: Array<[string, () => Promise<{ count: number }>]> = [
      ['invoices', () => this.prisma.invoice.deleteMany({ where })],
      ['jobs', () => this.prisma.job.deleteMany({ where })],
      [
        'bookings',
        () =>
          this.prisma.booking.deleteMany({ where: { ...where, job: null } }),
      ],
      ['expenses', () => this.prisma.expense.deleteMany({ where })],
      ['mileage entries', () => this.prisma.mileageEntry.deleteMany({ where })],
      ['journal entries', () => this.prisma.journalEntry.deleteMany({ where })],
      ['users', () => this.prisma.user.deleteMany({ where })],
    ];

    for (const [model, remove] of operations) {
      const result = await remove();
      if (result.count > 0) {
        this.logger.log(
          `Purged ${result.count} ${model} deleted before ${cutoff.toISOString()}`,
        );
      }
    }
  }
}
