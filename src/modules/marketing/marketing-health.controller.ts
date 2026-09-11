import { Controller, Get, UseGuards } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../../common/guards/auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { QUEUE_MARKETING } from '../../queues/queue.constants';
import { EmailEvent, EmailEventDocument } from './schemas/email-event.schema';

@ApiTags('Marketing Analytics')
@ApiBearerAuth()
@Controller('marketing/health')
@UseGuards(AuthGuard, AdminGuard)
export class MarketingHealthController {
  constructor(
    @InjectQueue(QUEUE_MARKETING) private readonly marketingQueue: Queue,
    @InjectConnection() private readonly mongo: Connection,
    @InjectModel(EmailEvent.name)
    private readonly eventModel: Model<EmailEventDocument>,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Marketing subsystem health: queue, MongoDB, worker heartbeat',
  })
  async health() {
    let queue: Record<string, unknown>;
    try {
      queue = (await this.marketingQueue.getJobCounts()) as unknown as Record<
        string,
        unknown
      >;
    } catch {
      queue = { error: 'queue unavailable' };
    }

    let mongo = 'up';
    try {
      const ready = this.mongo.readyState as number;
      if (ready !== 1) await this.mongo.asPromise();
      mongo = (this.mongo.readyState as number) === 1 ? 'up' : 'down';
    } catch {
      mongo = 'down';
    }

    // Worker heartbeat: most recent event it recorded
    let lastEventAt: string | null = null;
    try {
      const last = await this.eventModel
        .findOne({}, {}, { sort: { createdAt: -1 } })
        .select('createdAt')
        .lean<{ createdAt: Date } | null>()
        .exec();
      lastEventAt = last?.createdAt
        ? new Date(last.createdAt).toISOString()
        : null;
    } catch {
      lastEventAt = null;
    }

    return {
      success: true,
      data: { queue, mongo, lastEventAt },
    };
  }
}
