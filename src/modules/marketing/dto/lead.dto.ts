import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ArrayMaxSize,
  IsArray,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AB_GROUPS, FIT_TIERS, LEAD_STATUSES } from '../marketing.constants';

export class CreateLeadDto {
  @ApiPropertyOptional({ example: 'ND-03001' })
  @IsOptional()
  @IsString()
  leadId?: string;

  @ApiPropertyOptional({ enum: FIT_TIERS, example: 'A' })
  @IsOptional()
  @IsEnum(FIT_TIERS)
  fitTier?: string;

  @ApiPropertyOptional({ example: 80 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  prospectScore?: number;

  @ApiProperty({ example: 'Movil Notary' })
  @IsString()
  @MinLength(1)
  businessName: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  professionalName?: string;

  @ApiPropertyOptional({ example: 'https://example.com' })
  @IsOptional()
  @IsString()
  website?: string;

  @ApiPropertyOptional({ example: 'contact@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  emailVerification?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  facebookUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  instagramUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ example: 'IL' })
  @IsOptional()
  @IsString()
  @MaxLength(2)
  state?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  qualificationEvidence?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bestAngle?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  personalizationHook?: string;

  @ApiPropertyOptional({ example: 'Email' })
  @IsOptional()
  @IsString()
  recommendedChannel?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  verificationStatus?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  excludeFromSend?: boolean;

  @ApiPropertyOptional({ example: 'Wave 1 (Weeks 1-2)' })
  @IsOptional()
  @IsString()
  campaignWave?: string;

  @ApiPropertyOptional({ enum: AB_GROUPS })
  @IsOptional()
  @IsEnum(AB_GROUPS)
  abGroup?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  tags?: string[];
}

export class UpdateLeadDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  leadId?: string;

  @ApiPropertyOptional({ enum: FIT_TIERS })
  @IsOptional()
  @IsEnum(FIT_TIERS)
  fitTier?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  prospectScore?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  businessName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  professionalName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  website?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  emailVerification?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  facebookUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  instagramUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2)
  state?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  qualificationEvidence?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bestAngle?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  personalizationHook?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  recommendedChannel?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  verificationStatus?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  excludeFromSend?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  campaignWave?: string;

  @ApiPropertyOptional({ enum: AB_GROUPS })
  @IsOptional()
  @IsEnum(AB_GROUPS)
  abGroup?: string;

  @ApiPropertyOptional({ enum: LEAD_STATUSES })
  @IsOptional()
  @IsEnum(LEAD_STATUSES)
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  tags?: string[];
}

export class UpdateLeadMessageDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  subject?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50000)
  body?: string;
}

export const BULK_LEAD_ACTIONS = [
  'exclude',
  'include',
  'delete',
  'tag',
  'untag',
  'status',
] as const;

export class BulkLeadsDto {
  @ApiProperty({ type: [String], description: 'Lead ObjectIds' })
  @IsArray()
  @ArrayMaxSize(5000)
  @IsString({ each: true })
  ids: string[];

  @ApiProperty({ enum: BULK_LEAD_ACTIONS })
  @IsIn(BULK_LEAD_ACTIONS)
  action: string;

  @ApiPropertyOptional({
    description: 'Value for tag/untag (tag name) or status (LeadStatus)',
  })
  @IsOptional()
  @IsString()
  value?: string;
}
