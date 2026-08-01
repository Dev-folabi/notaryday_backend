import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bull';
import { JobsService } from './jobs.service';
import { PrismaService } from '../../config/prisma.service';
import { RedisService } from '../../config/redis.service';
import { GeocodingService } from '../geocoding/geocoding.service';
import { UserSettingsService } from '../users/user-settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  QUEUE_CALENDAR_SYNC,
  QUEUE_NOTIFICATION,
} from '../../queues/queue.constants';

describe('JobsService', () => {
  let service: JobsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JobsService,
        { provide: PrismaService, useValue: {} },
        { provide: RedisService, useValue: {} },
        { provide: GeocodingService, useValue: { geocode: jest.fn() } },
        { provide: UserSettingsService, useValue: { get: jest.fn() } },
        { provide: NotificationsService, useValue: {} },
        {
          provide: getQueueToken(QUEUE_CALENDAR_SYNC),
          useValue: { add: jest.fn() },
        },
        {
          provide: getQueueToken(QUEUE_NOTIFICATION),
          useValue: { add: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<JobsService>(JobsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
