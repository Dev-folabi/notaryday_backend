import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  MarketingSettings,
  MarketingSettingsDocument,
} from '../schemas/marketing-settings.schema';

const GLOBAL_ID = 'global' as const;

/** Shape returned to API clients (no internal _id). */
export interface MarketingSettingsDto {
  pixelTrackingUrl: string;
  pixelTrackingEnabled: boolean;
  physicalAddress: string;
}

@Injectable()
export class MarketingSettingsService {
  private readonly logger = new Logger(MarketingSettingsService.name);

  constructor(
    @InjectModel(MarketingSettings.name)
    private readonly model: Model<MarketingSettingsDocument>,
  ) {}

  /** Returns the singleton settings doc, creating it with defaults if absent. */
  async get(): Promise<MarketingSettingsDocument> {
    let doc = await this.model.findById(GLOBAL_ID).exec();
    if (!doc) {
      doc = await this.model
        .findById((await this.model.create({ _id: GLOBAL_ID }))._id)
        .exec();
      this.logger.log('Created default marketing_settings document');
    }
    return doc!;
  }

  /** Partial update — only the fields provided in `patch` are written. */
  async update(
    patch: Partial<MarketingSettingsDto>,
  ): Promise<MarketingSettingsDocument> {
    await this.model.updateOne({ _id: GLOBAL_ID }, { $set: patch }).exec();
    return this.get();
  }

  /** Convenience accessor used by the worker — avoids a DB call when the
   *  caller just needs the publicBaseUrl value. */
  async getPublicBaseUrl(): Promise<string> {
    const doc = await this.get();
    return doc.pixelTrackingUrl || 'http://localhost:4000';
  }

  async isPixelEnabled(): Promise<boolean> {
    const doc = await this.get();
    return doc.pixelTrackingEnabled;
  }
}
