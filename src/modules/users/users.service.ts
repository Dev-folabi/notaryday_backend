import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../config/prisma.service';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { User, PlanTier } from '../../../generated/prisma';

const BCRYPT_SALT_ROUNDS = 12;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { id },
      include: { settings: true, signing_defaults: true },
    });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: { settings: true },
    });
  }

  async findByUsername(username: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { username: username.toLowerCase() },
      include: { settings: true },
    });
  }

  async checkUsernameAvailable(username: string): Promise<boolean> {
    const existing = await this.prisma.user.findUnique({
      where: { username: username.toLowerCase() },
    });
    return !existing;
  }

  async create(data: {
    email: string;
    password: string;
    username: string;
    fullName?: string;
  }): Promise<User> {
    const passwordHash = await bcrypt.hash(data.password, BCRYPT_SALT_ROUNDS);

    const trialEnabled =
      this.configService.get<string>('TRIAL_PLAN') === 'true';
    const trialDays = this.configService.get<number>('TRIAL_DAYS') ?? 30;

    return this.prisma.user.create({
      data: {
        email: data.email.toLowerCase(),
        password_hash: passwordHash,
        username: data.username.toLowerCase(),
        full_name: data.fullName ?? null,
        ...(trialEnabled
          ? {
              plan: PlanTier.PRO,
              plan_expires_at: new Date(
                Date.now() + trialDays * 24 * 60 * 60 * 1000,
              ),
            }
          : {}),
        settings: {
          create: {
            irs_rate_per_mile:
              this.configService.get<number>('IRS_RATE_PER_MILE') ?? 0.725,
          },
        },
      },
      include: { settings: true },
    });
  }

  async updatePassword(userId: string, newPassword: string): Promise<void> {
    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_SALT_ROUNDS);
    await this.prisma.user.update({
      where: { id: userId },
      data: { password_hash: passwordHash },
    });
  }

  async validatePassword(user: User, password: string): Promise<boolean> {
    return bcrypt.compare(password, user.password_hash);
  }

  /** Change password when the user is authenticated — verifies the current
   *  password before applying the new one. */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) throw new NotFoundException('User not found');

    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) {
      throw new BadRequestException('Current password is incorrect');
    }

    await this.updatePassword(userId, newPassword);
  }

  /** Soft-delete the account: flags it for purge and drops billing so the
   *  user is no longer charged. All other data is retained for the purge window. */
  async softDeleteAccount(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!user) throw new NotFoundException('User not found');

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        deleted_at: new Date(),
        plan: 'FREE',
        plan_expires_at: null,
      },
    });
  }

  async updateProfile(
    userId: string,
    data: {
      fullName?: string;
      phone?: string;
      bio?: string;
      nnaCertified?: boolean;
      credentials?: string[];
    },
  ): Promise<User> {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        full_name: data.fullName ?? undefined,
        phone: data.phone ?? undefined,
        bio: data.bio ?? undefined,
        nna_certified: data.nnaCertified ?? undefined,
        credentials: data.credentials ?? undefined,
      },
      include: { settings: true },
    });
  }

  async updatePlan(
    userId: string,
    plan: PlanTier,
    expiresAt?: Date,
  ): Promise<User> {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        plan,
        plan_expires_at: expiresAt ?? null,
      },
    });
  }

  async setOnboardingComplete(userId: string): Promise<User> {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        onboarding_completed: true,
        onboarding_step: 4,
      },
      include: { settings: true },
    });
  }

  async updateOnboardingStep(userId: string, step: number): Promise<User> {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        onboarding_step: step,
        onboarding_completed: step >= 4,
      },
      include: { settings: true },
    });
  }

  // Password reset token methods
  async createPasswordResetToken(userId: string): Promise<string> {
    const token = crypto.randomUUID();
    const tokenHash = await bcrypt.hash(token, BCRYPT_SALT_ROUNDS);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await this.prisma.passwordResetToken.create({
      data: {
        user_id: userId,
        token_hash: tokenHash,
        expires_at: expiresAt,
      },
    });

    return token; // Return the raw token (sent via email)
  }

  async validatePasswordResetToken(
    token: string,
  ): Promise<{ userId: string; tokenId: string } | null> {
    const tokens = await this.prisma.passwordResetToken.findMany({
      where: {
        used: false,
        expires_at: { gt: new Date() },
      },
      orderBy: { created_at: 'desc' },
    });

    for (const t of tokens) {
      const valid = await bcrypt.compare(token, t.token_hash);
      if (valid) {
        return { userId: t.user_id, tokenId: t.id };
      }
    }

    return null;
  }

  async consumePasswordResetToken(tokenId: string): Promise<void> {
    await this.prisma.passwordResetToken.update({
      where: { id: tokenId },
      data: {
        used: true,
        used_at: new Date(),
      },
    });
  }

  async updateLastSeen(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { last_seen_at: new Date() },
    });
  }
}
