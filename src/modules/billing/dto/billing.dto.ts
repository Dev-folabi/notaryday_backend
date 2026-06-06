import { IsString, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateCheckoutDto {
  @ApiProperty({
    enum: ['pro_monthly', 'pro_annual'],
    example: 'pro_monthly',
    description: 'Subscription plan to purchase',
  })
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
