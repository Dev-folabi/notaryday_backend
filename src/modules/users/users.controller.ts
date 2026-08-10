import {
  Controller,
  Get,
  Patch,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  ConflictException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { UserSettingsService } from './user-settings.service';
import { AuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  IsString,
  IsOptional,
  IsBoolean,
  IsNumber,
  IsEnum,
  IsArray,
  IsObject,
} from 'class-validator';
import { NavApp } from '../../../generated/prisma';
import { Type } from 'class-transformer';

class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Jane Smith' })
  @IsOptional()
  @IsString()
  fullName?: string;

  @ApiPropertyOptional({ example: '+15125551234' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ example: 'Experienced mobile notary in Austin, TX' })
  @IsOptional()
  @IsString()
  bio?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  nnaCertified?: boolean;

  @ApiPropertyOptional({ example: ['NNA Certified', 'Background Checked'] })
  @IsOptional()
  @IsString({ each: true })
  credentials?: string[];
}

export class UpdateSettingsDto {
  @ApiPropertyOptional({ example: '100 Congress Ave, Austin, TX 78701' })
  @IsOptional()
  @IsString()
  home_base_address?: string;

  @ApiPropertyOptional({ example: 30.2672 })
  @IsOptional()
  @IsNumber()
  home_base_lat?: number;

  @ApiPropertyOptional({ example: -97.7431 })
  @IsOptional()
  @IsNumber()
  home_base_lng?: number;

  @ApiPropertyOptional({
    example: 0.67,
    description: 'IRS mileage rate per mile',
  })
  @IsOptional()
  @IsNumber()
  irs_rate_per_mile?: number;

  @ApiPropertyOptional({ example: 'sedan' })
  @IsOptional()
  @IsString()
  vehicle_type?: string;

  @ApiPropertyOptional({
    example: 50,
    description: 'Minimum acceptable net profit per job',
  })
  @IsOptional()
  @IsNumber()
  min_acceptable_net?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  bookingPageEnabled?: boolean;

  @ApiPropertyOptional({ example: 'Book me for your notary needs!' })
  @IsOptional()
  @IsString()
  bookingPageBio?: string;

  @ApiPropertyOptional({
    example: 30,
    description: 'Service area radius in miles',
  })
  @IsOptional()
  @IsNumber()
  serviceAreaMiles?: number;

  @ApiPropertyOptional({
    example: 30,
    description: 'Buffer between bookings in minutes',
  })
  @IsOptional()
  @IsNumber()
  bookingBufferMins?: number;

  @ApiPropertyOptional({ example: [] })
  @IsOptional()
  @IsArray()
  @Type(() => Object)
  booking_page_services?: Record<string, unknown>[];

  @ApiPropertyOptional({
    example: { Mon: { start: '08:00', end: '18:00' } },
    description: 'Active hours per day of week for the booking page',
  })
  @IsOptional()
  @Type(() => Object)
  booking_page_active_hours?: Record<string, { start?: string; end?: string }>;

  @ApiPropertyOptional({
    example: 0,
    description: 'Minimum notice hours required for a booking',
  })
  @IsOptional()
  @IsNumber()
  booking_min_notice_hours?: number;

  @ApiPropertyOptional({
    example: 30,
    description: 'Maximum days in advance a booking can be made',
  })
  @IsOptional()
  @IsNumber()
  booking_advance_limit_days?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  remindersEnabled?: boolean;

  @ApiPropertyOptional({
    example: 60,
    description: 'Reminder lead time in minutes',
  })
  @IsOptional()
  @IsNumber()
  reminderLeadMins?: number;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  clientEtaEnabled?: boolean;

  @ApiPropertyOptional({ enum: NavApp, example: 'GOOGLE_MAPS' })
  @IsOptional()
  @IsEnum(NavApp)
  preferredNavApp?: NavApp;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  onboarding_completed?: boolean;

  @ApiPropertyOptional({ example: 3 })
  @IsOptional()
  @IsNumber()
  onboarding_step?: number;

  @ApiPropertyOptional({ example: 30 })
  @IsOptional()
  @IsNumber()
  scanback_duration_mins?: number;

  @ApiPropertyOptional({
    example: [
      {
        signing_type: 'LOAN_REFI',
        signing_duration_mins: 60,
        scanback_duration_mins: 30,
      },
    ],
  })
  @IsOptional()
  @IsArray()
  signing_defaults?: {
    signing_type: string;
    signing_duration_mins: number;
    scanback_duration_mins: number;
  }[];

  @ApiPropertyOptional({
    example: {
      zelle: 'sarah@zelle.com',
      venmo: '@sarah-notary',
      paypal: 'sarah@paypal.me',
    },
    description:
      'Payment details shown on invoice PDFs so the client can pay directly. Accepts any object shape; only known keys (zelle, venmo, paypal, bank_name, account_last4, routing_last4, other) are kept.',
  })
  @IsOptional()
  @IsObject()
  paymentInfo?: Record<string, unknown>;
}

@ApiTags('Users')
@ApiBearerAuth()
@Controller('users')
@UseGuards(AuthGuard)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly userSettingsService: UserSettingsService,
  ) {}

  @Get('profile')
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiResponse({
    status: 200,
    description: 'User profile (excludes password_hash)',
  })
  async getProfile(@CurrentUser('id') userId: string) {
    const user = await this.usersService.findById(userId);
    if (!user) throw new ConflictException('User not found');
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password_hash, ...rest } = user;
    return rest;
  }

  @Patch('profile')
  @ApiOperation({ summary: 'Update user profile' })
  @ApiResponse({ status: 200, description: 'Updated profile' })
  async updateProfile(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateProfileDto,
  ) {
    const user = await this.usersService.updateProfile(userId, {
      fullName: dto.fullName,
      phone: dto.phone,
      bio: dto.bio,
      nnaCertified: dto.nnaCertified,
      credentials: dto.credentials,
    });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password_hash, ...rest } = user;
    return rest;
  }

  @Get('settings')
  @ApiOperation({ summary: 'Get user settings' })
  @ApiResponse({ status: 200, description: 'User settings object' })
  async getSettings(@CurrentUser('id') userId: string) {
    return this.userSettingsService.get(userId);
  }

  @Patch('settings')
  @ApiOperation({ summary: 'Update user settings' })
  @ApiResponse({ status: 200, description: 'Updated settings' })
  async updateSettings(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateSettingsDto,
  ) {
    if (
      dto.onboarding_completed !== undefined ||
      dto.onboarding_step !== undefined
    ) {
      const step =
        dto.onboarding_step ?? (dto.onboarding_completed ? 4 : undefined);
      if (step !== undefined)
        await this.usersService.updateOnboardingStep(userId, step);
    }

    const settings = await this.userSettingsService.update(userId, {
      home_base_address: dto.home_base_address,
      home_base_lat: dto.home_base_lat,
      home_base_lng: dto.home_base_lng,
      irs_rate_per_mile: dto.irs_rate_per_mile,
      vehicle_type: dto.vehicle_type,
      min_acceptable_net: dto.min_acceptable_net,
      bookingPageEnabled: dto.bookingPageEnabled,
      bookingPageBio: dto.bookingPageBio,
      serviceAreaMiles: dto.serviceAreaMiles,
      bookingBufferMins: dto.bookingBufferMins,
      bookingPageServices: dto.booking_page_services,
      bookingPageActiveHours: dto.booking_page_active_hours,
      bookingMinNoticeHours: dto.booking_min_notice_hours,
      bookingAdvanceLimitDays: dto.booking_advance_limit_days,
      remindersEnabled: dto.remindersEnabled,
      reminderLeadMins: dto.reminderLeadMins,
      clientEtaEnabled: dto.clientEtaEnabled,
      preferredNavApp: dto.preferredNavApp,
      scanback_duration_mins: dto.scanback_duration_mins,
      paymentInfo: dto.paymentInfo,
    });

    if (dto.signing_defaults && Array.isArray(dto.signing_defaults)) {
      for (const sd of dto.signing_defaults) {
        if (sd.signing_type) {
          await this.userSettingsService.upsertSigningDefault(
            userId,
            sd.signing_type,
            sd.signing_duration_mins,
            sd.scanback_duration_mins,
          );
        }
      }
    }

    return settings;
  }

  @Patch('onboarding/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark onboarding as complete' })
  @ApiResponse({ status: 200, description: 'Updated user' })
  async completeOnboarding(@CurrentUser('id') userId: string) {
    const user = await this.usersService.setOnboardingComplete(userId);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password_hash, ...rest } = user;
    return rest;
  }

  @Get('signing-defaults')
  @ApiOperation({ summary: 'Get signing type duration defaults' })
  @ApiResponse({
    status: 200,
    description: 'Array of signing defaults per type',
  })
  async getSigningDefaults(@CurrentUser('id') userId: string) {
    return this.userSettingsService.getSigningDefaults(userId);
  }
}
