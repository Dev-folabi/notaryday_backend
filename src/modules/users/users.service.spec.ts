import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { UsersService } from './users.service';
import { PrismaService } from '../../config/prisma.service';

describe('UsersService account management', () => {
  let service: UsersService;
  const prisma = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    passwordResetToken: {
      create: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue(0.725) },
        },
      ],
    }).compile();
    service = module.get<UsersService>(UsersService);
  });

  describe('changePassword()', () => {
    it('rejects an incorrect current password', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        password_hash: await bcrypt.hash('right', 4),
      });

      await expect(
        service.changePassword('u1', 'wrong', 'new-pass-123'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('updates the password when current is correct', async () => {
      const hash = await bcrypt.hash('right', 4);
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        password_hash: hash,
      });
      prisma.user.update.mockResolvedValue({ id: 'u1' });

      await service.changePassword('u1', 'right', 'new-pass-123');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u1' },
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        data: expect.objectContaining({ password_hash: expect.any(String) }),
      });
    });

    it('throws NotFound when user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.changePassword('nope', 'x', 'y')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('softDeleteAccount()', () => {
    it('flags the account as deleted and drops the plan', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u1' });
      prisma.user.update.mockResolvedValue({ id: 'u1' });

      await service.softDeleteAccount('u1');

      expect(prisma.user.update).toHaveBeenCalledTimes(1);
      const calls = prisma.user.update.mock.calls as unknown as [
        { where: { id: string }; data: Record<string, unknown> },
      ][];
      const arg = calls[0][0];
      expect(arg.where).toEqual({ id: 'u1' });
      expect(arg.data.deleted_at).toBeInstanceOf(Date);
      expect(arg.data.plan).toBe('FREE');
      expect(arg.data.plan_expires_at).toBeNull();
    });

    it('throws NotFound when user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(service.softDeleteAccount('nope')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('create() trial grant', () => {
    const config = { get: jest.fn() };
    const createMock = prisma.user.create;

    beforeEach(async () => {
      jest.clearAllMocks();
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          UsersService,
          { provide: PrismaService, useValue: prisma },
          { provide: ConfigService, useValue: config },
        ],
      }).compile();
      service = module.get<UsersService>(UsersService);
    });

    it('grants a Pro trial when TRIAL_PLAN=true', async () => {
      config.get.mockImplementation((key: string) => {
        if (key === 'IRS_RATE_PER_MILE') return 0.725;
        if (key === 'TRIAL_PLAN') return 'true';
        if (key === 'TRIAL_DAYS') return 30;
        return undefined;
      });
      createMock.mockResolvedValue({ id: 'u1' });

      await service.create({
        email: 'a@b.com',
        password: 'secret123',
        username: 'ab',
      });

      expect(createMock).toHaveBeenCalledTimes(1);
      const calls = createMock.mock.calls as unknown as [
        { data: { plan: string; plan_expires_at: Date } },
      ][];
      const arg = calls[0][0];
      expect(arg.data.plan).toBe('PRO');
      const expected = Date.now() + 30 * 24 * 60 * 60 * 1000;
      expect(
        Math.abs(arg.data.plan_expires_at.getTime() - expected),
      ).toBeLessThan(5000);
    });

    it('creates a FREE account when TRIAL_PLAN is off', async () => {
      config.get.mockImplementation((key: string) =>
        key === 'IRS_RATE_PER_MILE' ? 0.725 : undefined,
      );
      createMock.mockResolvedValue({ id: 'u1' });

      await service.create({
        email: 'a@b.com',
        password: 'secret123',
        username: 'ab',
      });

      const calls = createMock.mock.calls as unknown as [
        { data: Record<string, unknown> },
      ][];
      const arg = calls[0][0];
      expect(arg.data.plan).toBeUndefined();
      expect(arg.data.plan_expires_at).toBeUndefined();
    });
  });
});
