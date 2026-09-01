import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PrismaService } from '../../config/prisma.service';
import { AuthService } from '../auth/auth.service';
import { PlanTier, Prisma } from '../../../generated/prisma';
import {
  QUEUE_JOB_IMPORT,
  QUEUE_INVOICE,
  QUEUE_NOTIFICATION,
  QUEUE_CALENDAR_SYNC,
  QUEUE_BILLING_WEBHOOK,
} from '../../queues/queue.constants';

const SAFE_USER_SELECT = {
  id: true,
  email: true,
  username: true,
  full_name: true,
  phone: true,
  role: true,
  plan: true,
  plan_expires_at: true,
  onboarding_completed: true,
  onboarding_step: true,
  nna_certified: true,
  created_at: true,
  updated_at: true,
  last_seen_at: true,
  deleted_at: true,
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    @InjectQueue(QUEUE_JOB_IMPORT) private readonly jobImportQueue: Queue,
    @InjectQueue(QUEUE_INVOICE) private readonly invoiceQueue: Queue,
    @InjectQueue(QUEUE_NOTIFICATION) private readonly notificationQueue: Queue,
    @InjectQueue(QUEUE_CALENDAR_SYNC) private readonly calendarQueue: Queue,
    @InjectQueue(QUEUE_BILLING_WEBHOOK) private readonly billingQueue: Queue,
  ) {}

  // ----- Overview -----

  async getOverview() {
    const now = new Date();
    const days7 = new Date(now.getTime() - 7 * DAY_MS);
    const days30 = new Date(now.getTime() - 30 * DAY_MS);

    const [
      totalUsers,
      newUsers7d,
      newUsers30d,
      activeUsers7d,
      activeUsers30d,
      freeUsers,
      proUsers,
      proAnnualUsers,
      totalJobs,
      jobs30d,
      pendingBookings,
      pendingReviewJobs,
      failedImports,
      failedInvoices,
      pendingLsEvents,
      recentUsers,
    ] = await Promise.all([
      this.prisma.user.count({ where: { deleted_at: null } }),
      this.prisma.user.count({
        where: { deleted_at: null, created_at: { gte: days7 } },
      }),
      this.prisma.user.count({
        where: { deleted_at: null, created_at: { gte: days30 } },
      }),
      this.prisma.user.count({
        where: { deleted_at: null, last_seen_at: { gte: days7 } },
      }),
      this.prisma.user.count({
        where: { deleted_at: null, last_seen_at: { gte: days30 } },
      }),
      this.prisma.user.count({
        where: { deleted_at: null, plan: PlanTier.FREE },
      }),
      this.prisma.user.count({
        where: { deleted_at: null, plan: PlanTier.PRO },
      }),
      this.prisma.user.count({
        where: { deleted_at: null, plan: PlanTier.PRO_ANNUAL },
      }),
      this.prisma.job.count({ where: { deleted_at: null } }),
      this.prisma.job.count({
        where: { deleted_at: null, created_at: { gte: days30 } },
      }),
      this.prisma.booking.count({
        where: { deleted_at: null, status: 'PENDING_REVIEW' },
      }),
      this.prisma.job.count({
        where: { deleted_at: null, status: 'PENDING_REVIEW' },
      }),
      this.prisma.jobImport.count({ where: { status: 'FAILED' } }),
      this.prisma.invoice.count({ where: { email_failed_at: { not: null } } }),
      this.prisma.lemonSqueezyEvent.count({ where: { processed: false } }),
      this.prisma.user.findMany({
        where: { deleted_at: null },
        orderBy: { created_at: 'desc' },
        take: 10,
        select: SAFE_USER_SELECT,
      }),
    ]);

    const jobsByStatus = await this.prisma.job.groupBy({
      by: ['status'],
      where: { deleted_at: null },
      _count: { _all: true },
    });

    return {
      users: {
        total: totalUsers,
        new7d: newUsers7d,
        new30d: newUsers30d,
        active7d: activeUsers7d,
        active30d: activeUsers30d,
        byPlan: {
          FREE: freeUsers,
          PRO: proUsers,
          PRO_ANNUAL: proAnnualUsers,
        },
        recent: recentUsers,
      },
      jobs: {
        total: totalJobs,
        last30d: jobs30d,
        byStatus: jobsByStatus.map((row) => ({
          status: row.status,
          count: row._count._all,
        })),
      },
      ops: {
        pendingBookings,
        pendingReviewJobs,
        failedImports,
        failedInvoices,
        pendingLsEvents,
      },
    };
  }

  // ----- Users -----

  async listUsers(params: {
    search?: string;
    plan?: PlanTier;
    onboarding?: string;
    suspended?: string;
    page: number;
    limit: number;
  }) {
    const page = Math.max(1, params.page);
    const limit = Math.min(100, Math.max(1, params.limit));

    const where: Prisma.UserWhereInput = {
      deleted_at: params.suspended === 'true' ? { not: null } : null,
    };

    if (params.search) {
      where.OR = [
        { email: { contains: params.search, mode: 'insensitive' } },
        { username: { contains: params.search, mode: 'insensitive' } },
        { full_name: { contains: params.search, mode: 'insensitive' } },
      ];
    }
    if (params.plan) where.plan = params.plan;
    if (params.onboarding === 'true') where.onboarding_completed = true;
    if (params.onboarding === 'false') where.onboarding_completed = false;

    const [data, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          ...SAFE_USER_SELECT,
          _count: { select: { jobs: true } },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  async getUserDetail(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        settings: { select: { state: true, timezone: true } },
      },
    });
    if (!user) throw new NotFoundException('User not found');

    const [
      totalJobs,
      jobsByStatus,
      bookings,
      invoices,
      unpaidInvoices,
      expenses,
    ] = await Promise.all([
      this.prisma.job.count({ where: { user_id: id, deleted_at: null } }),
      this.prisma.job.groupBy({
        by: ['status'],
        where: { user_id: id, deleted_at: null },
        _count: { _all: true },
      }),
      this.prisma.booking.count({
        where: { notary_id: id, deleted_at: null },
      }),
      this.prisma.invoice.count({ where: { user_id: id, deleted_at: null } }),
      this.prisma.invoice.count({
        where: { user_id: id, deleted_at: null, is_paid: false },
      }),
      this.prisma.expense.count({ where: { user_id: id, deleted_at: null } }),
    ]);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password_hash, ...safeUser } = user;
    return {
      ...safeUser,
      stats: {
        totalJobs,
        jobsByStatus: jobsByStatus.map((row) => ({
          status: row.status,
          count: row._count._all,
        })),
        bookings,
        invoices,
        unpaidInvoices,
        expenses,
      },
    };
  }

  async updateUserPlan(id: string, plan: PlanTier, expiresAt?: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');

    return this.prisma.user.update({
      where: { id },
      data: {
        plan,
        plan_expires_at: expiresAt ? new Date(expiresAt) : null,
      },
      select: SAFE_USER_SELECT,
    });
  }

  async resetPassword(id: string): Promise<{ success: boolean }> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    if (user.deleted_at) {
      throw new BadRequestException(
        'Suspended users cannot reset their password',
      );
    }

    await this.authService.forgotPassword(user.email);
    return { success: true };
  }

  async suspendUser(id: string): Promise<{ success: boolean }> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    if (user.deleted_at)
      throw new BadRequestException('User is already suspended');

    await this.prisma.user.update({
      where: { id },
      data: {
        deleted_at: new Date(),
        plan: PlanTier.FREE,
        plan_expires_at: null,
      },
    });
    return { success: true };
  }

  async restoreUser(id: string): Promise<{ success: boolean }> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    if (!user.deleted_at)
      throw new BadRequestException('User is not suspended');

    await this.prisma.user.update({
      where: { id },
      data: { deleted_at: null },
    });
    return { success: true };
  }

  // ----- Jobs -----

  async listJobs(params: {
    status?: string;
    source?: string;
    userId?: string;
    from?: string;
    to?: string;
    page: number;
    limit: number;
  }) {
    const page = Math.max(1, params.page);
    const limit = Math.min(100, Math.max(1, params.limit));

    const where: Prisma.JobWhereInput = { deleted_at: null };
    if (params.status)
      where.status = params.status as Prisma.EnumJobStatusFilter;
    if (params.source)
      where.source = params.source as Prisma.EnumJobSourceFilter;
    if (params.userId) where.user_id = params.userId;

    if (params.from || params.to) {
      where.appointment_time = {};
      if (params.from) where.appointment_time.gte = new Date(params.from);
      if (params.to) {
        const to = new Date(params.to);
        to.setHours(23, 59, 59, 999);
        where.appointment_time.lte = to;
      }
    }

    const [data, total] = await Promise.all([
      this.prisma.job.findMany({
        where,
        orderBy: { appointment_time: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          user: { select: { id: true, email: true, username: true } },
        },
      }),
      this.prisma.job.count({ where }),
    ]);

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  // ----- System health -----

  async systemHealth() {
    const queueNames = [
      QUEUE_JOB_IMPORT,
      QUEUE_INVOICE,
      QUEUE_NOTIFICATION,
      QUEUE_CALENDAR_SYNC,
      QUEUE_BILLING_WEBHOOK,
    ];
    const queues = [
      this.jobImportQueue,
      this.invoiceQueue,
      this.notificationQueue,
      this.calendarQueue,
      this.billingQueue,
    ];

    const queueStats: Record<string, unknown> = {};
    await Promise.all(
      queues.map(async (queue, i) => {
        try {
          queueStats[queueNames[i]] = await queue.getJobCounts();
        } catch {
          queueStats[queueNames[i]] = { error: 'queue unavailable' };
        }
      }),
    );

    const [failedImports, importTotals, invoiceFailures, recentLsEvents] =
      await Promise.all([
        this.prisma.jobImport.count({ where: { status: 'FAILED' } }),
        this.prisma.jobImport.groupBy({
          by: ['status'],
          _count: { _all: true },
        }),
        this.prisma.invoice.count({
          where: { email_failed_at: { not: null } },
        }),
        this.prisma.lemonSqueezyEvent.findMany({
          orderBy: { created_at: 'desc' },
          take: 20,
        }),
      ]);

    return {
      queues: queueStats,
      imports: {
        failed: failedImports,
        byStatus: importTotals.map((row) => ({
          status: row.status,
          count: row._count._all,
        })),
      },
      invoices: { emailFailures: invoiceFailures },
      lemonsqueezy: {
        total: await this.prisma.lemonSqueezyEvent.count(),
        pending: await this.prisma.lemonSqueezyEvent.count({
          where: { processed: false },
        }),
        recent: recentLsEvents,
      },
    };
  }
}
