import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import { PrismaService } from '../config/prisma.service';
import { NotificationsService } from '../modules/notifications/notifications.service';
import { QUEUE_EMAIL_SEQUENCE } from '../queues/queue.constants';
import {
  getExistingUserEmailSequence,
  getNewUserEmailSequence,
  getFirstName,
} from '../modules/notifications/email-sequences';

const US_ET_TIMEZONE = 'America/New_York';

@Injectable()
export class EmailSequenceCronService {
  private readonly logger = new Logger(EmailSequenceCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    @InjectQueue(QUEUE_EMAIL_SEQUENCE)
    private readonly emailSequenceQueue: Queue,
  ) {}

  /**
   * Catch up on any missed email sequence days.
   * Runs every 5 minutes, only fires 10:00-10:05 ET.
   */
  @Cron('*/5 * * * *', { timeZone: US_ET_TIMEZONE })
  async checkPendingEmails() {
    const now = new Date();
    const etFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: US_ET_TIMEZONE,
      hour: '2-digit',
      minute: '2-digit',
    });
    const etParts = etFormatter.formatToParts(now);
    const etHourStr = etParts.find((p) => p.type === 'hour')?.value;
    const etMinuteStr = etParts.find((p) => p.type === 'minute')?.value;
    const etHour = etHourStr ? parseInt(etHourStr, 10) : -1;
    const etMinute = etMinuteStr ? parseInt(etMinuteStr, 10) : -1;

    if (etHour !== 10 || etMinute > 5) {
      return;
    }

    const sequences = await this.prisma.emailSequence.findMany({
      where: {
        OR: [
          { day0SentAt: null },
          { day1SentAt: null },
          { day2SentAt: null },
          { day3SentAt: null },
          { day4SentAt: null },
        ],
      },
      include: { user: true },
    });

    for (const seq of sequences) {
      if (!seq.user) continue;
      const firstName = getFirstName(seq.user.full_name);
      const trialDays = seq.user.plan_expires_at
        ? Math.max(
            1,
            Math.ceil(
              (seq.user.plan_expires_at.getTime() - Date.now()) /
                (24 * 60 * 60 * 1000),
            ),
          )
        : undefined;

      const sequence =
        seq.sequenceType === 'existing_user'
          ? getExistingUserEmailSequence(firstName, trialDays)
          : getNewUserEmailSequence(firstName, trialDays);

      for (let day = 0; day <= 4; day++) {
        const sentField = `day${day}SentAt` as keyof typeof seq;
        if (seq[sentField]) continue;

        const email = sequence[day];
        if (!email) continue;

        try {
          await this.emailSequenceQueue.add(
            'send-email',
            {
              userId: seq.userId,
              sequenceType: seq.sequenceType,
              day,
            },
            {
              jobId: `email-seq-${seq.sequenceType}-${seq.userId}-day${day}-cron`,
              attempts: 3,
              backoff: { type: 'exponential', delay: 2000 },
            },
          );
          this.logger.log(
            `Cron: scheduled email sequence day ${day} for ${seq.userId} (${seq.sequenceType})`,
          );
        } catch (err) {
          this.logger.error(
            `Cron: failed to schedule email day ${day} for ${seq.userId}:`,
            err instanceof Error ? err.stack : String(err),
          );
        }
      }
    }
  }

  /**
   * Daily backfill: find existing users with no emailSequence record
   * and start their onboarding sequence. Runs at 08:00 ET.
   */
  @Cron('0 8 * * *', { timeZone: US_ET_TIMEZONE })
  async backfillExistingUsers() {
    if (process.env.NODE_ENV !== 'production') return;

    const started = await this.notifications.backfillExistingUserSequences(50);
    if (started > 0) {
      this.logger.log(
        `Backfill: started email sequences for ${started} existing users`,
      );
    }
  }
}
