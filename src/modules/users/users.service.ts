import { Injectable, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import * as bcrypt from 'bcrypt';
import { User, PlanTier } from '../../../generated/prisma';

const BCRYPT_SALT_ROUNDS = 12;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { id },
      include: { settings: true },
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

    return this.prisma.user.create({
      data: {
        email: data.email.toLowerCase(),
        password_hash: passwordHash,
        username: data.username.toLowerCase(),
        full_name: data.fullName ?? null,
        settings: {
          create: {
            // IRS rate defaults per spec: $0.72/mile (2024 rate)
            irs_rate_per_mile: 0.72,
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
    });
  }

  async updateOnboardingStep(
    userId: string,
    step: number,
  ): Promise<User> {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        onboarding_step: step,
        onboarding_completed: step >= 4,
      },
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