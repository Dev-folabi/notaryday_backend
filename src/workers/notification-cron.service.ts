import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '../config/prisma.service';
import { QUEUE_NOTIFICATION } from '../queues/queue.constants';
import { JobStatus } from '../../generated/prisma';

@Injectable()
export class NotificationCronService {
  private readonly logger = new Logger(NotificationCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_NOTIFICATION) private readonly notifQueue: Queue,
  ) {}

  /** Every 5 minutes: check for jobs starting in 30 min, send reminders */
  @Cron('*/5 * * * *')
  async dispatchPreSigningReminders() {
    const now = new Date();
    const in30 = new Date(now.getTime() + 30 * 60_000);
    const in35 = new Date(now.getTime() + 35 * 60_000);

    const jobs = await this.prisma.job.findMany({
      where: {
        deleted_at: null,
        status: JobStatus.CONFIRMED,
        appointment_time: { gte: in30, lt: in35 },
      },
    });

    for (const job of jobs) {
      // Check if reminder already sent (avoid duplicates)
      const existing = await this.prisma.notification.findFirst({
        where: {
          user_id: job.user_id,
          job_id: job.id,
          type: 'JOB_REMINDER',
          created_at: { gte: now },
        },
      });
      if (existing) continue;

      await this.notifQueue.add('send-reminder', {
        userId: job.user_id,
        jobId: job.id,
        type: 'pre_signing',
      });
    }

    if (jobs.length > 0)
      this.logger.log(`Dispatched ${jobs.length} pre-signing reminders`);
  }

  /** Every day at 9 PM: send daily summary to users who had jobs today */
  @Cron('0 21 * * *')
  async dispatchDailySummaries() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const usersWithJobs = await this.prisma.job.findMany({
      where: {
        deleted_at: null,
        status: JobStatus.COMPLETE,
        appointment_time: { gte: today, lt: tomorrow },
      },
      select: { user_id: true },
      distinct: ['user_id'],
    });

    for (const { user_id } of usersWithJobs) {
      await this.notifQueue.add('daily-summary', {
        userId: user_id,
        date: today.toISOString().slice(0, 10),
      });
    }

    if (usersWithJobs.length > 0)
      this.logger.log(`Dispatched ${usersWithJobs.length} daily summaries`);
  }
}
