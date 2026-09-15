import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/**
 * Singleton document (fixed _id = "global") storing marketing-wide settings
 * that can be changed at runtime without restarting the API/worker.
 */
@Schema({
  collection: 'marketing_settings',
  timestamps: true,
  versionKey: false,
  _id: false,
})
export class MarketingSettings {
  /** Always "global" — enforced by the service layer. */
  @Prop({ type: String, required: true })
  _id: string;

  /** Base URL used for tracking pixel, click-wrap, and unsubscribe links. */
  @Prop({ default: 'http://localhost:4000', type: String })
  pixelTrackingUrl: string;

  /** Whether the open-tracking pixel is injected into campaign emails. */
  @Prop({ default: true, type: Boolean })
  pixelTrackingEnabled: boolean;

  /** Physical address shown in the email footer (CAN-SPAM). */
  @Prop({ default: '', type: String })
  physicalAddress: string;

  createdAt: Date;
  updatedAt: Date;
}

export type MarketingSettingsDocument = HydratedDocument<MarketingSettings>;

export const MarketingSettingsSchema =
  SchemaFactory.createForClass(MarketingSettings);
