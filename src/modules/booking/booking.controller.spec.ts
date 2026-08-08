import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { BookingController } from './booking.controller';
import { BookingService } from './booking.service';
import { AuthService } from '../auth/auth.service';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { SigningType } from '../../../generated/prisma';

describe('BookingController', () => {
  let controller: BookingController;
  let reflector: Reflector;
  const service = {
    getSlots: jest.fn(),
    suggestAlternatives: jest.fn(),
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    analyze: jest.fn(),
    approve: jest.fn(),
    decline: jest.fn(),
    cancel: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BookingController],
      providers: [
        { provide: BookingService, useValue: service },
        { provide: AuthService, useValue: {} },
      ],
    }).compile();

    controller = module.get<BookingController>(BookingController);
    reflector = module.get<Reflector>(Reflector);
    jest.clearAllMocks();
  });

  function isPublic(handler: (...args: unknown[]) => unknown): boolean {
    return !!reflector.get<boolean>(IS_PUBLIC_KEY, handler);
  }

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('exposes GET book/:username/slots as a public route', () => {
    expect(isPublic(controller.getSlots)).toBe(true);
  });

  it('exposes POST book/:username as a public route', () => {
    expect(isPublic(controller.createBooking)).toBe(true);
  });

  it('exposes GET book/:username/alternatives as a public route', () => {
    expect(isPublic(controller.getAlternatives)).toBe(true);
  });

  it('requires auth for GET bookings/:id/analysis', () => {
    expect(isPublic(controller.analyze)).toBe(false);
  });

  it('requires auth for GET bookings/:id', () => {
    expect(isPublic(controller.findOne)).toBe(false);
  });

  it('requires auth for POST bookings/:id/cancel', () => {
    expect(isPublic(controller.cancel)).toBe(false);
  });

  it('delegates getSlots and wraps the response', async () => {
    service.getSlots.mockResolvedValue({ slots: ['2026-08-03T10:00:00.000Z'] });
    const result = await controller.getSlots('janenotary', {
      date: '2026-08-03',
      service_type: SigningType.GENERAL,
    });
    expect(service.getSlots).toHaveBeenCalledWith(
      'janenotary',
      '2026-08-03',
      SigningType.GENERAL,
    );
    expect(result).toEqual({
      success: true,
      data: { slots: ['2026-08-03T10:00:00.000Z'] },
    });
  });

  it('delegates getAlternatives and wraps the response', async () => {
    service.suggestAlternatives.mockResolvedValue({
      slots: [{ time: '14:00', iso: '2026-08-03T18:00:00.000Z' }],
    });
    const result = await controller.getAlternatives('janenotary', {
      date: '2026-08-03',
      time: '13:00',
      service_type: SigningType.GENERAL,
    });
    expect(service.suggestAlternatives).toHaveBeenCalledWith(
      'janenotary',
      '2026-08-03',
      '13:00',
      SigningType.GENERAL,
    );
    expect(result).toEqual({
      success: true,
      data: { slots: [{ time: '14:00', iso: '2026-08-03T18:00:00.000Z' }] },
    });
  });

  it('delegates createBooking and wraps the response', async () => {
    const dto = {
      client_name: 'John Doe',
      client_email: 'john@example.com',
      address: '789 Elm St',
      service_type: SigningType.GENERAL,
      requested_time: '2026-08-03T10:00:00.000Z',
    };
    const booking = { id: 'bk-1', status: 'PENDING_REVIEW' };
    service.create.mockResolvedValue(booking);
    const result = await controller.createBooking('janenotary', dto);
    expect(service.create).toHaveBeenCalledWith('janenotary', dto);
    expect(result).toEqual({ success: true, data: booking });
  });

  it('delegates decline and wraps the response', async () => {
    service.decline.mockResolvedValue({ id: 'bk-1', status: 'DECLINED' });
    const result = await controller.decline('notary-1', 'bk-1', {
      reason: 'Busy',
    });
    expect(service.decline).toHaveBeenCalledWith('notary-1', 'bk-1', {
      reason: 'Busy',
    });
    expect(result).toEqual({
      success: true,
      data: { id: 'bk-1', status: 'DECLINED' },
    });
  });

  it('delegates cancel and wraps the response', async () => {
    service.cancel.mockResolvedValue({
      id: 'bk-1',
      status: 'CANCELLED_BY_CLIENT',
    });
    const result = await controller.cancel('notary-1', 'bk-1');
    expect(service.cancel).toHaveBeenCalledWith('notary-1', 'bk-1');
    expect(result).toEqual({
      success: true,
      data: { id: 'bk-1', status: 'CANCELLED_BY_CLIENT' },
    });
  });
});
