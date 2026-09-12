import {
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
  Max,
  MinLength,
  IsEmail,
  IsBoolean,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PROVIDER_TYPES } from '../marketing.constants';

export class CreateProviderDto {
  @ApiProperty({ example: 'Brevo main' })
  @IsString()
  @MinLength(2)
  name: string;

  @ApiProperty({ enum: PROVIDER_TYPES, example: 'brevo' })
  @IsIn(PROVIDER_TYPES)
  type: string;

  @ApiProperty({ example: 'Yusuf' })
  @IsString()
  @MinLength(1)
  fromName: string;

  @ApiProperty({ example: 'yusuf@go.notaryday.app' })
  @IsEmail()
  fromEmail: string;

  @ApiPropertyOptional({ example: 'yusuf@notaryday.app' })
  @IsOptional()
  @IsEmail()
  replyTo?: string;

  @ApiProperty({
    description:
      'Credentials object — keys depend on type: apiKey (resend/brevo), user+password (zoho), user+appPassword (gmail)',
    example: { apiKey: 'xkeys-ib-...' },
  })
  @IsObject()
  credentials: Record<string, string>;

  @ApiPropertyOptional({ default: 30, minimum: 1 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(600)
  perMinuteLimit?: number;

  @ApiPropertyOptional({ default: 100, minimum: 1 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100000)
  dailyLimit?: number;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  warmupEnabled?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
