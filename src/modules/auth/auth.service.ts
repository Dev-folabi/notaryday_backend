import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { UserSettingsService } from '../users/user-settings.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly userSettingsService: UserSettingsService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async register(data: {
    email: string;
    password: string;
    username: string;
    fullName?: string;
  }) {
    // Check email not taken
    const existingEmail = await this.usersService.findByEmail(data.email);
    if (existingEmail) {
      throw new ConflictException('Email already registered');
    }

    // Check username not taken
    const existingUsername = await this.usersService.findByUsername(
      data.username,
    );
    if (existingUsername) {
      throw new ConflictException(
        'That username is taken — try a different one',
      );
    }

    // Create user
    const user = await this.usersService.create({
      email: data.email,
      password: data.password,
      username: data.username,
      fullName: data.fullName,
    });

    // Seed signing type defaults
    await this.userSettingsService.seedSigningDefaults(user.id);

    // Send welcome email
    try {
      await this.notificationsService.sendWelcomeEmail(
        user.email,
        user.full_name || user.username || 'Notary',
      );
    } catch (error) {
      console.warn(`Failed to send welcome email to ${user.email}:`, error);
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password_hash, ...rest } = user;
    return rest;
  }

  async login(email: string, password: string) {
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const valid = await this.usersService.validatePassword(user, password);
    if (!valid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    await this.usersService.updateLastSeen(user.id);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password_hash, ...rest } = user;
    return rest;
  }

  async forgotPassword(email: string): Promise<{ sent: boolean }> {
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      // Don't reveal whether email exists
      return { sent: true };
    }

    const token = await this.usersService.createPasswordResetToken(user.id);

    // Send password reset email via Resend
    try {
      const appUrl = process.env.APP_URL || 'http://localhost:3000';
      await this.notificationsService.sendPasswordResetEmail(
        user.email,
        token,
        appUrl,
      );
    } catch (error) {
      console.error(`Failed to send password reset email to ${email}:`, error);
    }

    return { sent: true };
  }

  async resetPassword(
    token: string,
    newPassword: string,
  ): Promise<{ success: boolean }> {
    const result = await this.usersService.validatePasswordResetToken(token);
    if (!result) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    await this.usersService.updatePassword(result.userId, newPassword);
    await this.usersService.consumePasswordResetToken(result.tokenId);

    return { success: true };
  }

  async getMe(userId: string) {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password_hash, ...rest } = user;
    return rest;
  }
}
