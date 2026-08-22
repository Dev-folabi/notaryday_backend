import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from '../../common/guards/auth.guard';
import { PlanGuard } from '../../common/guards/plan.guard';
import { Public } from '../../common/decorators/public.decorator';
import { RequiresPro } from '../../common/decorators/requires-pro.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { BookingService } from './booking.service';
import {
  CreateBookingDto,
  DeclineBookingDto,
  GetSlotsQueryDto,
  GetAlternativesQueryDto,
} from './dto/booking.dto';
import { BookingStatus } from '../../../generated/prisma';

@ApiTags('Bookings')
@Controller()
export class BookingController {
  constructor(private readonly bookings: BookingService) {}

  @Get('book/:username/slots')
  @Public()
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  @ApiOperation({
    summary: 'Get available booking slots for a notary (public)',
  })
  @ApiParam({ name: 'username', example: 'janenotary' })
  @ApiQuery({ name: 'date', required: true, example: '2025-06-02' })
  @ApiQuery({
    name: 'service_type',
    required: false,
    enum: [
      'GENERAL',
      'LOAN_REFI',
      'HYBRID',
      'PURCHASE_CLOSING',
      'FIELD_INSPECTION',
      'APOSTILLE',
    ],
  })
  @ApiResponse({ status: 200, description: 'Available time slots' })
  async getSlots(
    @Param('username') username: string,
    @Query() query: GetSlotsQueryDto,
  ) {
    const result = await this.bookings.getSlots(
      username,
      query.date,
      query.service_type,
    );
    return { success: true, data: result };
  }

  @Get('book/:username/alternatives')
  @Public()
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  @ApiOperation({
    summary: 'Suggest alternative slots near a requested time (public)',
  })
  @ApiParam({ name: 'username', example: 'janenotary' })
  @ApiQuery({ name: 'date', required: true, example: '2025-06-02' })
  @ApiQuery({ name: 'time', required: true, example: '14:00' })
  @ApiQuery({
    name: 'service_type',
    required: false,
    enum: [
      'GENERAL',
      'LOAN_REFI',
      'HYBRID',
      'PURCHASE_CLOSING',
      'FIELD_INSPECTION',
      'APOSTILLE',
    ],
  })
  @ApiResponse({ status: 200, description: 'Alternative time slots' })
  async getAlternatives(
    @Param('username') username: string,
    @Query() query: GetAlternativesQueryDto,
  ) {
    const result = await this.bookings.suggestAlternatives(
      username,
      query.date,
      query.time,
      query.service_type,
    );
    return { success: true, data: result };
  }

  @Post('book/:username')
  @Public()
  @ApiOperation({ summary: 'Create a booking request (public)' })
  @ApiParam({ name: 'username', example: 'janenotary' })
  @ApiResponse({
    status: 201,
    description: 'Booking created with PENDING_REVIEW status',
  })
  async createBooking(
    @Param('username') username: string,
    @Body() dto: CreateBookingDto,
  ) {
    const booking = await this.bookings.create(username, dto);
    return { success: true, data: booking };
  }

  @Get('bookings')
  @UseGuards(AuthGuard, PlanGuard)
  @RequiresPro()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all bookings for the authenticated notary' })
  @ApiQuery({ name: 'status', required: false, enum: BookingStatus })
  @ApiResponse({ status: 200, description: 'Array of bookings' })
  async findAll(
    @CurrentUser('id') userId: string,
    @Query('status') status?: BookingStatus,
  ) {
    const bookings = await this.bookings.findAll(userId, status);
    return { success: true, data: bookings };
  }

  @Get('bookings/:id')
  @UseGuards(AuthGuard, PlanGuard)
  @RequiresPro()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get a single booking by ID' })
  @ApiParam({ name: 'id', description: 'Booking UUID' })
  @ApiResponse({ status: 200, description: 'Booking object' })
  @ApiResponse({ status: 404, description: 'Booking not found' })
  async findOne(@CurrentUser('id') userId: string, @Param('id') id: string) {
    const booking = await this.bookings.findOne(userId, id);
    return { success: true, data: booking };
  }

  @Get('bookings/:id/analysis')
  @UseGuards(AuthGuard, PlanGuard)
  @RequiresPro()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get booking profitability & conflict analysis' })
  @ApiParam({ name: 'id', description: 'Booking UUID' })
  @ApiResponse({ status: 200, description: 'Booking analysis' })
  async analyze(@CurrentUser('id') userId: string, @Param('id') id: string) {
    const result = await this.bookings.analyze(userId, id);
    return { success: true, data: result };
  }

  @Post('bookings/:id/approve')
  @UseGuards(AuthGuard, PlanGuard)
  @RequiresPro()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Approve a pending booking request' })
  @ApiParam({ name: 'id', description: 'Booking UUID' })
  @ApiResponse({ status: 200, description: 'Booking approved, job created' })
  async approve(@CurrentUser('id') userId: string, @Param('id') id: string) {
    const result = await this.bookings.approve(userId, id);
    return { success: true, data: result };
  }

  @Patch('bookings/:id/decline')
  @UseGuards(AuthGuard, PlanGuard)
  @RequiresPro()
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Decline a booking with optional reason and alternatives',
  })
  @ApiParam({ name: 'id', description: 'Booking UUID' })
  @ApiResponse({ status: 200, description: 'Booking declined' })
  async decline(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: DeclineBookingDto,
  ) {
    const result = await this.bookings.decline(userId, id, dto);
    return { success: true, data: result };
  }

  @Post('bookings/:id/cancel')
  @UseGuards(AuthGuard, PlanGuard)
  @RequiresPro()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cancel a confirmed booking' })
  @ApiParam({ name: 'id', description: 'Booking UUID' })
  @ApiResponse({ status: 200, description: 'Booking cancelled' })
  async cancel(@CurrentUser('id') userId: string, @Param('id') id: string) {
    const result = await this.bookings.cancel(userId, id);
    return { success: true, data: result };
  }
}
