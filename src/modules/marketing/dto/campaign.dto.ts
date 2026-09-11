import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  AB_GROUPS,
  AUDIENCE_MODES,
  CAMPAIGN_TYPES,
  CONTENT_MODES,
  FIT_TIERS,
  WAVE_KEYS,
} from '../marketing.constants';

export class CampaignAudienceFiltersDto {
  @ApiPropertyOptional({ enum: FIT_TIERS })
  @IsOptional()
  @IsIn(FIT_TIERS)
  tier?: string;

  @ApiPropertyOptional({ enum: WAVE_KEYS })
  @IsOptional()
  @IsIn(WAVE_KEYS)
  wave?: string;

  @ApiPropertyOptional({ example: 'TX' })
  @IsOptional()
  @IsString()
  @MaxLength(2)
  state?: string;

  @ApiPropertyOptional({ enum: AB_GROUPS })
  @IsOptional()
  @IsIn(AB_GROUPS)
  abGroup?: string;

  @ApiPropertyOptional({ example: 'Email' })
  @IsOptional()
  @IsString()
  channel?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  tags?: string[];
}

export class CampaignUserFiltersDto {
  @ApiPropertyOptional({
    enum: ['FREE', 'PRO', 'PRO_ANNUAL'],
    description: 'Plan tier filter',
  })
  @IsOptional()
  @IsIn(['FREE', 'PRO', 'PRO_ANNUAL'])
  plan?: string;

  @ApiPropertyOptional({
    description: 'No login for at least N days',
    minimum: 1,
    maximum: 365,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  inactiveDays?: number;

  @ApiPropertyOptional({ description: 'Onboarding completed state' })
  @IsOptional()
  @IsBoolean()
  onboardingCompleted?: boolean;
}

export class CampaignAudienceDto {
  @ApiPropertyOptional({ enum: AUDIENCE_MODES, default: 'FILTER' })
  @IsOptional()
  @IsIn(AUDIENCE_MODES)
  mode?: string;

  @ApiPropertyOptional({ type: CampaignAudienceFiltersDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CampaignAudienceFiltersDto)
  filters?: CampaignAudienceFiltersDto;

  @ApiPropertyOptional({
    type: CampaignUserFiltersDto,
    description: 'Platform-user filters (mode=USERS, re-engagement)',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => CampaignUserFiltersDto)
  userFilters?: CampaignUserFiltersDto;

  @ApiPropertyOptional({
    type: [String],
    description: 'Explicit lead ObjectIds (IDS mode)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5000)
  @IsString({ each: true })
  leadIds?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5000)
  @IsString({ each: true })
  excludeLeadIds?: string[];
}

export class CampaignContentDto {
  @ApiProperty({ enum: CONTENT_MODES })
  @IsIn(CONTENT_MODES)
  mode: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 9,
    description: 'ONE_OFF + LEAD_DRAFTS: which step to send (default 1)',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(9)
  step?: number;

  @ApiPropertyOptional({
    type: [Number],
    description: 'SEQUENCE + LEAD_DRAFTS: steps 1-9 (default all)',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(9)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(9, { each: true })
  steps?: number[];

  @ApiPropertyOptional({ description: 'TEMPLATE mode subject ({{vars}} ok)' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  subject?: string;

  @ApiPropertyOptional({ description: 'TEMPLATE mode body ({{vars}} ok)' })
  @IsOptional()
  @IsString()
  @MaxLength(50000)
  body?: string;
}

export class CreateCampaignDto {
  @ApiProperty({ example: 'Wave 1 — full sequence' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name: string;

  @ApiProperty({ enum: CAMPAIGN_TYPES.filter((t) => t !== 'DIRECT') })
  @IsIn(['ONE_OFF', 'SEQUENCE'])
  type: string;

  @ApiProperty({ description: 'Email provider ObjectId' })
  @IsString()
  providerId: string;

  @ApiProperty({ type: CampaignAudienceDto })
  @ValidateNested()
  @Type(() => CampaignAudienceDto)
  audience: CampaignAudienceDto;

  @ApiProperty({ type: CampaignContentDto })
  @ValidateNested()
  @Type(() => CampaignContentDto)
  content: CampaignContentDto;

  @ApiPropertyOptional({ description: 'ISO date; defaults to now' })
  @IsOptional()
  @IsDateString()
  startAt?: string;

  @ApiPropertyOptional({
    description: 'Sends per minute; capped at the provider limit',
    default: 15,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(600)
  perMinute?: number;

  @ApiPropertyOptional({
    description: 'Deliver in the recipient local 8–11 AM window',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  smartSendTimes?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  stopOnReply?: boolean;
}

export class UpdateCampaignDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ type: CampaignAudienceDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CampaignAudienceDto)
  audience?: CampaignAudienceDto;

  @ApiPropertyOptional({ type: CampaignContentDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CampaignContentDto)
  content?: CampaignContentDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  startAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(600)
  perMinute?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  smartSendTimes?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  stopOnReply?: boolean;
}

export class ScheduleCampaignDto {
  @ApiPropertyOptional({ description: 'ISO date; defaults to now' })
  @IsOptional()
  @IsDateString()
  startAt?: string;
}

export class PreviewCampaignDto {
  @ApiProperty({ enum: ['ONE_OFF', 'SEQUENCE'] })
  @IsIn(['ONE_OFF', 'SEQUENCE'])
  type: string;

  @ApiProperty({ type: CampaignAudienceDto })
  @ValidateNested()
  @Type(() => CampaignAudienceDto)
  audience: CampaignAudienceDto;

  @ApiProperty({ type: CampaignContentDto })
  @ValidateNested()
  @Type(() => CampaignContentDto)
  content: CampaignContentDto;
}

export class DirectSendDto {
  @ApiProperty({ enum: ['LEAD', 'USER', 'EMAIL'] })
  @IsIn(['LEAD', 'USER', 'EMAIL'])
  targetType: string;

  @ApiPropertyOptional({ description: 'Lead ObjectId (targetType=LEAD)' })
  @IsOptional()
  @IsString()
  leadId?: string;

  @ApiPropertyOptional({ description: 'Platform user id (targetType=USER)' })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional({ description: 'Raw email (targetType=EMAIL)' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({ example: 'Quick question about your booking page' })
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  subject: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(50000)
  body: string;

  @ApiPropertyOptional({
    description: 'Defaults to the default/first active provider',
  })
  @IsOptional()
  @IsString()
  providerId?: string;

  @ApiPropertyOptional({ description: 'ISO date; defaults to now' })
  @IsOptional()
  @IsDateString()
  scheduleAt?: string;
}

export class CreateSuppressionDto {
  @ApiProperty({ example: 'stop@example.com' })
  @IsEmail()
  email: string;

  @ApiPropertyOptional({
    enum: ['UNSUBSCRIBE', 'BOUNCE', 'COMPLAINT', 'MANUAL'],
  })
  @IsOptional()
  @IsIn(['UNSUBSCRIBE', 'BOUNCE', 'COMPLAINT', 'MANUAL'])
  type?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
