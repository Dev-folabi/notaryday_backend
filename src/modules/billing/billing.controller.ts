import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { BillingService } from './billing.service';
import { CreateCheckoutDto } from './dto/billing.dto';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RequestWithUser } from '../../common/interfaces/request-with-user.interface';

@ApiTags('Billing')
@ApiBearerAuth()
@Controller('billing')
@UseGuards(AuthGuard)
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Post('subscribe')
  @ApiOperation({ summary: 'Create a checkout session for Pro subscription' })
  @ApiResponse({ status: 201, description: 'Returns checkout URL' })
  async createCheckout(
    @Body() dto: CreateCheckoutDto,
    @Request() req: RequestWithUser,
  ) {
    return this.billingService.createCheckout(req.user.id, dto.plan);
  }

  @Get('portal')
  @ApiOperation({
    summary: 'Get customer portal URL for subscription management',
  })
  @ApiResponse({ status: 200, description: 'Returns portal URL' })
  async getPortal(@Request() req: RequestWithUser) {
    return this.billingService.getCustomerPortalUrl(req.user.id);
  }

  @Post('cancel')
  @ApiOperation({ summary: 'Cancel current subscription' })
  @ApiResponse({ status: 200, description: 'Subscription cancelled' })
  async cancel(@Request() req: RequestWithUser) {
    return this.billingService.cancelSubscription(req.user.id);
  }

  @Get('status')
  @ApiOperation({ summary: 'Get current subscription status' })
  @ApiResponse({
    status: 200,
    description: 'Subscription status and plan details',
  })
  async getStatus(@Request() req: RequestWithUser) {
    return this.billingService.getSubscriptionStatus(req.user.id);
  }
}
