import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import { PrismaService } from '../config/prisma.service';
import { NotificationsService } from '../modules/notifications/notifications.service';
import { EmailRendererService } from '../common/email/email-renderer.service';
import {
  getExistingUserEmailSequence,
  getNewUserEmailSequence,
  getFirstName,
} from '../modules/notifications/email-sequences';
import { QUEUE_EMAIL_SEQUENCE } from '../queues/queue.constants';

export interface EmailSequenceJobData {
  userId: string;
  sequenceType: 'new_user' | 'existing_user';
  day: number;
}

@Processor(QUEUE_EMAIL_SEQUENCE)
export class EmailSequenceProcessor {
  private readonly logger = new Logger(EmailSequenceProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly emailRenderer: EmailRendererService,
  ) {}

  @Process('send-email')
  async handleSendEmail(job: Job<EmailSequenceJobData>) {
    const { userId, sequenceType, day } = job.data;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user || user.deleted_at) {
      this.logger.warn(
        `User not found or deleted for email sequence: ${userId}`,
      );
      return;
    }
    const firstName = getFirstName(user.full_name);
    const trialDays = user.plan_expires_at
      ? Math.max(
          1,
          Math.ceil(
            (user.plan_expires_at.getTime() - Date.now()) /
              (24 * 60 * 60 * 1000),
          ),
        )
      : undefined;

    const sequence =
      sequenceType === 'existing_user'
        ? getExistingUserEmailSequence(firstName, trialDays)
        : getNewUserEmailSequence(firstName, trialDays);

    const email = sequence[day];
    if (!email) {
      this.logger.warn(`Invalid day ${day} for user ${userId}`);
      return;
    }

    const rendered = this.emailRenderer.render({
      title: email.title,
      subtitle: email.subtitle,
      greeting: email.greeting,
      intro: email.intro,
      contentHtml: email.contentHtml,
      footer: email.footer,
      plainText: email.plainText,
    });

    await this.notifications.sendEmail({
      to: user.email,
      subject: email.subject,
      html: rendered.html,
      text: rendered.text,
    });

    await this.prisma.emailSequence.update({
      where: { userId },
      data: {
        [`day${day}SentAt`]: new Date(),
        currentDay: day + 1,
      },
    });

    this.logger.log(
      `Email sequence day ${day} sent to ${user.email} (${sequenceType})`,
    );
  }
}
