import { Body, Controller, Get, Patch } from '@nestjs/common';
import { MarketingSettingsService } from './marketing-settings.service';

@Controller('marketing/settings')
export class MarketingSettingsController {
  constructor(private readonly settings: MarketingSettingsService) {}

  @Get()
  get() {
    return this.settings.get();
  }

  @Patch()
  update(
    @Body()
    body: {
      pixelTrackingUrl?: string;
      pixelTrackingEnabled?: boolean;
      physicalAddress?: string;
    },
  ) {
    return this.settings.update(body);
  }
}
