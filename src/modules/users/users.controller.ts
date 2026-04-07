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
import { IsString, IsOptional, IsEmail, IsBoolean, IsNumber } from 'class-validator';

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
  homeBaseAddress?: string;

  @IsOptional()
  @IsNumber()
  homeBaseLat?: number;

  @IsOptional()
  @IsNumber()
  homeBaseLng?: number;

  @IsOptional()
  @IsNumber()
  irsRatePerMile?: number;

  @IsOptional()
  @IsString()
  vehicleType?: string;

  @IsOptional()
  @IsNumber()
  minAcceptableNet?: number;

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
  @IsString()
  preferredNavApp?: string;
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
    return this.userSettingsService.update(userId, {
      homeBaseAddress: dto.homeBaseAddress,
      homeBaseLat: dto.homeBaseLat,
      homeBaseLng: dto.homeBaseLng,
      irsRatePerMile: dto.irsRatePerMile,
      vehicleType: dto.vehicleType,
      minAcceptableNet: dto.minAcceptableNet,
      bookingPageEnabled: dto.bookingPageEnabled,
      bookingPageBio: dto.bookingPageBio,
      serviceAreaMiles: dto.serviceAreaMiles,
      bookingBufferMins: dto.bookingBufferMins,
      remindersEnabled: dto.remindersEnabled,
      reminderLeadMins: dto.reminderLeadMins,
      clientEtaEnabled: dto.clientEtaEnabled,
      preferredNavApp: dto.preferredNavApp as any,
    });
  }

  @Get('signing-defaults')
  async getSigningDefaults(@CurrentUser('id') userId: string) {
    return this.userSettingsService.getSigningDefaults(userId);
  }
}