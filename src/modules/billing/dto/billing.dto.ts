import { IsString, IsOptional } from 'class-validator';

export class CreateCheckoutDto {
  @IsString()
  plan: 'pro_monthly' | 'pro_annual';
}

export class WebhookEventDto {
  @IsString()
  @IsOptional()
  meta?: {
    event_name?: string;
    custom_data?: {
      user_id?: string;
    };
  };

  [key: string]: any;
}
