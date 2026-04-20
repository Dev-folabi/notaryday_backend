import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from 'src/config/prisma.service';
import { PlanTier, Prisma } from '../../../generated/prisma';
import crypto from 'crypto';

export interface LemonSqueezyAttributes {
  variant_id: number;
  status: string;
  customer_id: number;
  renews_at?: string | null;
  ends_at?: string | null;
}

export interface LemonSqueezyData {
  id: string;
  type: string;
  attributes: LemonSqueezyAttributes;
}

export interface LemonSqueezyPayload {
  data: LemonSqueezyData;
  meta?: {
    event_name?: string;
    id?: string;
    custom_data?: {
      user_id?: string;
    };
  };
  event_name?: string;
  id?: string;
}

export interface LemonSqueezyOrdersResponse {
  data: Array<{
    id: string;
  }>;
}

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Create a Lemon Squeezy checkout session
   */
  async createCheckout(userId: string, plan: 'pro_monthly' | 'pro_annual') {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new Error('User not found');
    }

    const storeId = this.config.get<string>('LEMONSQUEEZY_STORE_ID');
    const variantId =
      plan === 'pro_monthly'
        ? this.config.get<string>('LEMONSQUEEZY_PRO_MONTHLY_VARIANT_ID')
        : this.config.get<string>('LEMONSQUEEZY_PRO_ANNUAL_VARIANT_ID');

    if (!storeId || !variantId) {
      throw new Error('Lemon Squeezy not configured');
    }

    const appUrl =
      this.config.get<string>('APP_URL') ?? 'http://localhost:3000';

    // Build checkout URL with user_id in custom data for webhook
    const checkoutUrl = new URL(
      'https://store.lemonsqueezy.com/checkout/buy/' + variantId,
    );
    checkoutUrl.searchParams.set('checkout[custom][user_id]', userId);
    checkoutUrl.searchParams.set(
      'checkout[redirect_url]',
      `${appUrl}/settings/billing?success=true`,
    );
    checkoutUrl.searchParams.set(
      'checkout[cancel_url]',
      `${appUrl}/settings/billing?cancelled=true`,
    );
    checkoutUrl.searchParams.set('checkout[customer_email]', user.email);

    return {
      checkoutUrl: checkoutUrl.toString(),
    };
  }

  /**
   * Get customer portal URL for subscription management
   */
  async getCustomerPortalUrl(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user?.lemon_squeezy_customer_id) {
      throw new Error('No active subscription found');
    }

    const apiKey = this.config.get<string>('LEMONSQUEEZY_API_KEY');
    if (!apiKey) {
      throw new Error('Lemon Squeezy not configured');
    }

    const response = await fetch(
      `https://api.lemonsqueezy.com/v1/customers/${user.lemon_squeezy_customer_id}`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/vnd.api+json',
          'Content-Type': 'application/vnd.api+json',
        },
      },
    );

    if (!response.ok) {
      throw new Error('Failed to get customer portal URL');
    }

    // Get the first order to generate a portal URL
    const ordersResponse = await fetch(
      `https://api.lemonsqueezy.com/v1/orders?filter[customer_id]=${user.lemon_squeezy_customer_id}`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/vnd.api+json',
        },
      },
    );

    if (!ordersResponse.ok) {
      throw new Error('Failed to get order info');
    }

    const ordersData =
      (await ordersResponse.json()) as LemonSqueezyOrdersResponse;
    const orderId = ordersData.data?.[0]?.id;

    if (!orderId) {
      throw new Error('No orders found');
    }

    // Use the order to generate a checkout URL for portal
    const portalUrl = `https://store.lemonsqueezy.com/order/${orderId}/customer_portal`;

    return { portalUrl };
  }

  /**
   * Cancel subscription (schedules cancellation at period end)
   */
  async cancelSubscription(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user?.lemon_squeezy_subscription_id) {
      throw new Error('No active subscription found');
    }

    const apiKey = this.config.get<string>('LEMONSQUEEZY_API_KEY');
    if (!apiKey) {
      throw new Error('Lemon Squeezy not configured');
    }

    const response = await fetch(
      `https://api.lemonsqueezy.com/v1/subscriptions/${user.lemon_squeezy_subscription_id}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/vnd.api+json',
          'Content-Type': 'application/vnd.api+json',
        },
        body: JSON.stringify({
          data: {
            type: 'subscriptions',
            attributes: {
              cancelled: true,
            },
          },
        }),
      },
    );

    if (!response.ok) {
      const error = await response.text();
      this.logger.error(`Failed to cancel subscription: ${error}`);
      throw new Error('Failed to cancel subscription');
    }

    return { success: true };
  }

  /**
   * Get subscription status for a user
   */
  async getSubscriptionStatus(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new Error('User not found');
    }

    return {
      plan: user.plan,
      lemonSqueezyCustomerId: user.lemon_squeezy_customer_id,
      lemonSqueezySubscriptionId: user.lemon_squeezy_subscription_id,
      planExpiresAt: user.plan_expires_at,
    };
  }

  /**
   * Verify Lemon Squeezy webhook signature
   */
  verifyWebhookSignature(payload: string, signature: string): boolean {
    const secret = this.config.get<string>('LEMONSQUEEZY_WEBHOOK_SECRET');
    if (!secret) {
      this.logger.warn('LEMONSQUEEZY_WEBHOOK_SECRET not configured');
      return false;
    }

    const hmac = crypto.createHmac('sha256', secret);
    const digest = hmac.update(payload).digest('hex');

    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
  }

  /**
   * Handle subscription_created webhook
   */
  async handleSubscriptionCreated(payload: LemonSqueezyPayload) {
    const { data } = payload;
    const attributes = data.attributes;
    const customData = payload.meta?.custom_data || {};
    const userId = customData.user_id;

    if (!userId) {
      this.logger.warn('subscription_created webhook missing user_id');
      return { processed: false };
    }

    const plan =
      attributes.variant_id.toString() ===
      this.config.get<string>('LEMONSQUEEZY_PRO_MONTHLY_VARIANT_ID')
        ? PlanTier.PRO
        : PlanTier.PRO_ANNUAL;

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        plan,
        lemon_squeezy_customer_id: attributes.customer_id.toString(),
        lemon_squeezy_subscription_id: data.id.toString(),
      },
    });

    this.logger.log(`User ${userId} upgraded to ${plan}`);
    return { processed: true };
  }

  /**
   * Handle subscription_updated webhook
   */
  async handleSubscriptionUpdated(payload: LemonSqueezyPayload) {
    const { data } = payload;
    const attributes = data.attributes;

    // Find user by subscription_id
    const user = await this.prisma.user.findFirst({
      where: { lemon_squeezy_subscription_id: data.id.toString() },
    });

    if (!user) {
      this.logger.warn(
        `subscription_updated: user not found for subscription ${data.id}`,
      );
      return { processed: false };
    }

    // Check if subscription is still active
    if (attributes.status === 'active' || attributes.status === 'trialing') {
      const plan =
        attributes.variant_id.toString() ===
        this.config.get<string>('LEMONSQUEEZY_PRO_MONTHLY_VARIANT_ID')
          ? PlanTier.PRO
          : PlanTier.PRO_ANNUAL;

      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          plan,
          plan_expires_at: attributes.renews_at
            ? new Date(attributes.renews_at)
            : null,
        },
      });
    }

    return { processed: true };
  }

  /**
   * Handle subscription_cancelled webhook
   */
  async handleSubscriptionCancelled(payload: LemonSqueezyPayload) {
    const { data } = payload;
    const attributes = data.attributes;

    const user = await this.prisma.user.findFirst({
      where: { lemon_squeezy_subscription_id: data.id.toString() },
    });

    if (!user) {
      this.logger.warn(
        `subscription_cancelled: user not found for subscription ${data.id}`,
      );
      return { processed: false };
    }

    // Keep access until period end
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        plan_expires_at: attributes.ends_at
          ? new Date(attributes.ends_at)
          : null,
      },
    });

    this.logger.log(
      `User ${user.id} subscription cancelled, access until ${attributes.ends_at}`,
    );
    return { processed: true };
  }

  /**
   * Handle subscription_expired webhook
   */
  async handleSubscriptionExpired(payload: LemonSqueezyPayload) {
    const { data } = payload;

    const user = await this.prisma.user.findFirst({
      where: { lemon_squeezy_subscription_id: data.id.toString() },
    });

    if (!user) {
      this.logger.warn(
        `subscription_expired: user not found for subscription ${data.id}`,
      );
      return { processed: false };
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        plan: PlanTier.FREE,
        lemon_squeezy_subscription_id: null,
        plan_expires_at: null,
      },
    });

    this.logger.log(
      `User ${user.id} downgraded to FREE (subscription expired)`,
    );
    return { processed: true };
  }

  /**
   * Handle subscription_payment_failed webhook
   */
  async handleSubscriptionPaymentFailed(payload: LemonSqueezyPayload) {
    const { data } = payload;

    const user = await this.prisma.user.findFirst({
      where: { lemon_squeezy_subscription_id: data.id.toString() },
    });

    if (!user) {
      this.logger.warn(
        `subscription_payment_failed: user not found for subscription ${data.id}`,
      );
      return { processed: false };
    }

    // Keep access for now (will be revoked after retry attempts)
    // Could trigger notification email here
    this.logger.warn(
      `Payment failed for user ${user.id}, subscription ${data.id}`,
    );
    return { processed: true };
  }

  /**
   * Find if a Lemon Squeezy event has already been processed
   */
  async findEvent(id: string) {
    return this.prisma.lemonSqueezyEvent.findUnique({
      where: { id },
    });
  }

  /**
   * Log a Lemon Squeezy event for idempotency
   */
  async createEvent(data: {
    id: string;
    event_name: string;
    payload: LemonSqueezyPayload;
    processed: boolean;
  }) {
    return this.prisma.lemonSqueezyEvent.create({
      data: {
        id: data.id,
        event_name: data.event_name,
        payload: data.payload as unknown as Prisma.InputJsonValue,
        processed: data.processed,
      },
    });
  }

  /**
   * Update a Lemon Squeezy event's processed status
   */
  async updateEvent(id: string, processed: boolean) {
    return this.prisma.lemonSqueezyEvent.update({
      where: { id },
      data: {
        processed,
        processed_at: new Date(),
      },
    });
  }

  /**
   * Atomic idempotency check for Lemon Squeezy events
   */
  async processIdempotency(
    id: string,
    eventName: string,
    payload: LemonSqueezyPayload,
  ) {
    return this.createEvent({
      id,
      event_name: eventName,
      payload,
      processed: false,
    });
  }

  /**
   * Process incoming webhook
   */
  async processWebhook(eventName: string, payload: LemonSqueezyPayload) {
    switch (eventName) {
      case 'subscription_created':
        return this.handleSubscriptionCreated(payload);
      case 'subscription_updated':
        return this.handleSubscriptionUpdated(payload);
      case 'subscription_cancelled':
        return this.handleSubscriptionCancelled(payload);
      case 'subscription_expired':
        return this.handleSubscriptionExpired(payload);
      case 'subscription_payment_failed':
        return this.handleSubscriptionPaymentFailed(payload);
      default:
        this.logger.warn(`Unhandled webhook event: ${eventName}`);
        return { processed: false };
    }
  }
}
