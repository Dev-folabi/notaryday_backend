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
});
