import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import { BillingService } from './billing.service';
import { CreateCheckoutDto } from './dto/billing.dto';
import { AuthGuard } from '../../common/guards/auth.guard';
import { RequestWithUser } from '../../common/interfaces/request-with-user.interface';

@Controller('billing')
@UseGuards(AuthGuard)
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  /**
   * Create a checkout session for Pro subscription
   */
  @Post('subscribe')
  async createCheckout(
    @Body() dto: CreateCheckoutDto,
    @Request() req: RequestWithUser,
  ) {
    return this.billingService.createCheckout(req.user.id, dto.plan);
  }

  /**
   * Get customer portal URL for subscription management
   */
  @Get('portal')
  async getPortal(@Request() req: RequestWithUser) {
    return this.billingService.getCustomerPortalUrl(req.user.id);
  }

  /**
   * Cancel subscription
   */
  @Post('cancel')
  async cancel(@Request() req: RequestWithUser) {
    return this.billingService.cancelSubscription(req.user.id);
  }

  /**
   * Get current subscription status
   */
  @Get('status')
  async getStatus(@Request() req: RequestWithUser) {
    return this.billingService.getSubscriptionStatus(req.user.id);
  }
}
