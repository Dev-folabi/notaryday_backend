import {
  Controller,
  Post,
  Body,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
  Get,
  Param,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { Public } from '../../common/decorators/public.decorator';
import { AuthGuard, RequestWithUser } from '../../common/guards/auth.guard';
import { IsEmail, IsString, MinLength, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { User } from 'generated/prisma';

class RegisterDto {
  @ApiProperty({ example: 'notary@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'SecureP@ss1', minLength: 8 })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiProperty({ example: 'janenotary', minLength: 2 })
  @IsString()
  @MinLength(2)
  username: string;

  @ApiPropertyOptional({ example: 'Jane Smith' })
  @IsOptional()
  @IsString()
  fullName?: string;
}

class LoginDto {
  @ApiProperty({ example: 'notary@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'SecureP@ss1' })
  @IsString()
  password: string;
}

class ForgotPasswordDto {
  @ApiProperty({ example: 'notary@example.com' })
  @IsEmail()
  email: string;
}

class ResetPasswordDto {
  @ApiProperty({ description: 'Password reset token from email link' })
  @IsString()
  token: string;

  @ApiProperty({ example: 'NewSecureP@ss1', minLength: 8 })
  @IsString()
  @MinLength(8)
  newPassword: string;
}

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
  ) {}

  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Register a new notary account' })
  @ApiResponse({
    status: 201,
    description: 'Account created, returns JWT token',
  })
  @ApiResponse({ status: 409, description: 'Email or username already taken' })
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Public()
  @Post('login')
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email and password' })
  @ApiResponse({ status: 200, description: 'Returns JWT access token' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto.email, dto.password);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout and revoke current token' })
  @ApiResponse({ status: 200, description: 'Token revoked' })
  async logout(@Req() req: Request) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      await this.authService.revokeToken(token);
    }
    return { success: true };
  }

  @Public()
  @Post('forgot-password')
  @Throttle({ default: { ttl: 60000, limit: 3 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request a password reset email' })
  @ApiResponse({
    status: 200,
    description: 'Reset email sent if account exists',
  })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto.email);
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset password using token from email' })
  @ApiResponse({ status: 200, description: 'Password updated' })
  @ApiResponse({ status: 400, description: 'Invalid or expired token' })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.token, dto.newPassword);
  }

  @Get('me')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current authenticated user' })
  @ApiResponse({ status: 200, description: 'Current user object' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  me(@Req() req: RequestWithUser): User {
    return req.user;
  }

  @Get('username-check/:username')
  @Public()
  @ApiOperation({ summary: 'Check if a username is available' })
  @ApiParam({ name: 'username', example: 'janenotary' })
  @ApiResponse({ status: 200, description: 'Returns { available: boolean }' })
  async checkUsername(@Param('username') username: string) {
    const available = await this.usersService.checkUsernameAvailable(username);
    return { available };
  }
}
