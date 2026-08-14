import { IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class PushSubscriptionDto {
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(2000)
  endpoint!: string;

  @IsString()
  @MaxLength(500)
  p256dh!: string;

  @IsString()
  @MaxLength(500)
  auth!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  user_agent?: string;
}

export class RemovePushSubscriptionDto {
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(2000)
  endpoint!: string;
}
