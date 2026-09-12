import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  Lead,
  LeadDocument,
} from '../../../modules/marketing/schemas/lead.schema';
import {
  EmailEvent,
  EmailEventDocument,
} from '../../../modules/marketing/schemas/email-event.schema';
import type { ConversionKind } from '../../../modules/marketing/marketing.constants';

interface ConversionEvent {
  email: string;
  userId?: string;
  kind: ConversionKind;
}

/**
 * Matches platform conversions (signup / CITT / Pro upgrade) back to CRM
 * leads by email: links the lead, promotes status to CONVERTED and records
 * an engagement event. This is what powers the funnel lead → signup →
 * CITT → Pro in analytics.
 */
@Injectable()
export class ConversionService {
  private readonly logger = new Logger(ConversionService.name);

  constructor(
    @InjectModel(Lead.name) private readonly leadModel: Model<LeadDocument>,
    @InjectModel(EmailEvent.name)
    private readonly eventModel: Model<EmailEventDocument>,
  ) {}

  async process(event: ConversionEvent): Promise<void> {
    const email = event.email?.trim().toLowerCase();
    if (!email) return;

    const lead = await this.leadModel.findOne({ email }).exec();
    if (!lead) {
      // Not a CRM lead — fine, most signups won't be.
      this.logger.debug(`Conversion (${event.kind}) for non-lead ${email}`);
      return;
    }

    // Pro conversion is the strongest signal; don't downgrade REPLIED/CONVERTED
    const nextStatus =
      event.kind === 'pro' || lead.status !== 'REPLIED'
        ? 'CONVERTED'
        : lead.status;
    await this.leadModel
      .updateOne(
        { _id: lead._id },
        { $set: { status: nextStatus, linkedUserEmail: email } },
      )
      .exec();

    await this.eventModel.create({
      leadRef: lead._id,
      email,
      type: 'CONVERTED',
      source: 'API',
      meta: { kind: event.kind, userId: event.userId },
    });
    this.logger.log(
      `Lead ${lead.leadId ?? lead.businessName ?? email} converted (${event.kind})`,
    );
  }
}
