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
} from 'class-validator';
import { NavApp } from '../../../generated/prisma';

class UpdateProfileDto {
  @IsOptional()
  @IsString()
  fullName?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  bio?: string;

  @IsOptional()
  @IsBoolean()
  nnaCertified?: boolean;

  @IsOptional()
  @IsString({ each: true })
  credentials?: string[];
}

class UpdateSettingsDto {
  @IsOptional()
  @IsString()
  home_base_address?: string;

  @IsOptional()
  @IsNumber()
  home_base_lat?: number;

  @IsOptional()
  @IsNumber()
  home_base_lng?: number;

  @IsOptional()
  @IsNumber()
  irs_rate_per_mile?: number;

  @IsOptional()
  @IsString()
  vehicle_type?: string;

  @IsOptional()
  @IsNumber()
  min_acceptable_net?: number;

  @IsOptional()
  @IsBoolean()
  bookingPageEnabled?: boolean;

  @IsOptional()
  @IsString()
  bookingPageBio?: string;

  @IsOptional()
  @IsNumber()
  serviceAreaMiles?: number;

  @IsOptional()
  @IsNumber()
  bookingBufferMins?: number;

  @IsOptional()
  @IsBoolean()
  remindersEnabled?: boolean;

  @IsOptional()
  @IsNumber()
  reminderLeadMins?: number;

  @IsOptional()
  @IsBoolean()
  clientEtaEnabled?: boolean;

  @IsOptional()
  @IsEnum(NavApp)
  preferredNavApp?: NavApp;

  @IsOptional()
  @IsBoolean()
  onboarding_completed?: boolean;

  @IsOptional()
  @IsNumber()
  onboarding_step?: number;

  @IsOptional()
  @IsNumber()
  scanback_duration_mins?: number;

  @IsOptional()
  @IsArray()
  signing_defaults?: {
    signing_type: string;
    signing_duration_mins: number;
    scanback_duration_mins: number;
  }[];
}

@Controller('users')
@UseGuards(AuthGuard)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly userSettingsService: UserSettingsService,
  ) {}

  @Get('profile')
  async getProfile(@CurrentUser('id') userId: string) {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new ConflictException('User not found');
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password_hash, ...rest } = user;
    return rest;
  }

  @Patch('profile')
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
  async getSettings(@CurrentUser('id') userId: string) {
    return this.userSettingsService.get(userId);
  }

  @Patch('settings')
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
      if (step !== undefined) {
        await this.usersService.updateOnboardingStep(userId, step);
      }
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
      remindersEnabled: dto.remindersEnabled,
      reminderLeadMins: dto.reminderLeadMins,
      clientEtaEnabled: dto.clientEtaEnabled,
      preferredNavApp: dto.preferredNavApp,
      scanback_duration_mins: dto.scanback_duration_mins,
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
  async completeOnboarding(@CurrentUser('id') userId: string) {
    const user = await this.usersService.setOnboardingComplete(userId);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password_hash, ...rest } = user;
    return rest;
  }

  @Get('signing-defaults')
  async getSigningDefaults(@CurrentUser('id') userId: string) {
    return this.userSettingsService.getSigningDefaults(userId);
  }
}
