import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { JobStatus } from '../../../generated/prisma';

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Earnings report grouped by period */
  async earnings(
    userId: string,
    from: string,
    to: string,
    groupBy: 'week' | 'month' = 'month',
  ) {
    const jobs = await this.prisma.job.findMany({
      where: {
        user_id: userId,
        deleted_at: null,
        status: JobStatus.COMPLETE,
        appointment_time: { gte: new Date(from), lte: new Date(to) },
      },
      orderBy: { appointment_time: 'asc' },
    });

    let gross = 0,
      mileageCost = 0,
      platformFees = 0,
      totalMiles = 0,
      totalHours = 0;
    const periods: Record<
      string,
      { gross: number; net: number; jobs: number; miles: number }
    > = {};
    const clients: Record<string, number> = {};

    for (const j of jobs) {
      const fee = Number(j.fee);
      const mc = Number(j.mileage_cost ?? 0);
      const pf = Number(j.platform_fee);
      const miles = Number(j.mileage_miles ?? 0);
      const hours =
        (j.signing_duration_mins +
          (j.scanback_duration_mins ?? 0) +
          (j.drive_from_prev_mins ?? 0)) /
        60;

      gross += fee;
      mileageCost += mc;
      platformFees += pf;
      totalMiles += miles;
      totalHours += hours;

      // Group by period
      const d = j.appointment_time;
      const key =
        groupBy === 'week'
          ? `${d.getFullYear()}-W${String(Math.ceil((d.getDate() + new Date(d.getFullYear(), d.getMonth(), 1).getDay()) / 7)).padStart(2, '0')}`
          : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

      if (!periods[key]) periods[key] = { gross: 0, net: 0, jobs: 0, miles: 0 };
      periods[key].gross += fee;
      periods[key].net += fee - mc - pf;
      periods[key].jobs += 1;
      periods[key].miles += miles;

      // Client tracking
      const client = j.platform_name ?? j.client_name ?? 'Direct';
      clients[client] = (clients[client] ?? 0) + fee;
    }

    const net = gross - mileageCost - platformFees;
    const effectiveHourly = totalHours > 0 ? net / totalHours : 0;

    return {
      summary: {
        gross,
        mileageCost,
        platformFees,
        net,
        totalMiles,
        totalHours,
        effectiveHourly,
        jobCount: jobs.length,
      },
      periods: Object.entries(periods).map(([period, data]) => ({
        period,
        ...data,
      })),
      topClients: Object.entries(clients)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([name, revenue]) => ({ name, revenue })),
    };
  }

  /** Mileage report for a year */
  async mileage(userId: string, year: number) {
    const from = new Date(`${year}-01-01`);
    const to = new Date(`${year + 1}-01-01`);

    const jobs = await this.prisma.job.findMany({
      where: {
        user_id: userId,
        deleted_at: null,
        status: JobStatus.COMPLETE,
        appointment_time: { gte: from, lt: to },
        mileage_miles: { not: null },
      },
      orderBy: { appointment_time: 'asc' },
      select: {
        appointment_time: true,
        address: true,
        mileage_miles: true,
        mileage_cost: true,
      },
    });

    const settings = await this.prisma.userSettings.findUnique({
      where: { user_id: userId },
    });
    const irsRate = Number(settings?.irs_rate_per_mile ?? 0.725);

    let totalMiles = 0,
      totalDeduction = 0;
    const monthly: Record<string, { miles: number; deduction: number }> = {};

    for (const j of jobs) {
      const miles = Number(j.mileage_miles);
      const deduction = miles * irsRate;
      totalMiles += miles;
      totalDeduction += deduction;

      const key = `${j.appointment_time.getFullYear()}-${String(j.appointment_time.getMonth() + 1).padStart(2, '0')}`;
      if (!monthly[key]) monthly[key] = { miles: 0, deduction: 0 };
      monthly[key].miles += miles;
      monthly[key].deduction += deduction;
    }

    return {
      year,
      irsRate,
      totalMiles,
      totalDeduction,
      entries: jobs.map((j) => ({
        date: j.appointment_time,
        address: j.address,
        miles: Number(j.mileage_miles),
        deduction: Number(j.mileage_miles) * irsRate,
      })),
      monthly: Object.entries(monthly).map(([month, data]) => ({
        month,
        ...data,
      })),
    };
  }

  /** Tax report data (for PDF/CSV generation) */
  async taxReport(userId: string, year: number) {
    const [earnings, mileage, expenseSummary] = await Promise.all([
      this.earnings(userId, `${year}-01-01`, `${year}-12-31`, 'month'),
      this.mileage(userId, year),
      this.prisma.expense.findMany({
        where: {
          user_id: userId,
          deleted_at: null,
          expense_date: {
            gte: new Date(`${year}-01-01`),
            lt: new Date(`${year + 1}-01-01`),
          },
        },
      }),
    ]);

    // Journal acts count
    const actsCount = await this.prisma.journalEntry.count({
      where: {
        user_id: userId,
        deleted_at: null,
        entry_date: {
          gte: new Date(`${year}-01-01`),
          lt: new Date(`${year + 1}-01-01`),
        },
      },
    });

    // Expenses by category
    const expensesByCategory: Record<string, number> = {};
    let totalExpenses = 0;
    for (const e of expenseSummary) {
      const amt = Number(e.amount);
      totalExpenses += amt;
      expensesByCategory[e.category] =
        (expensesByCategory[e.category] ?? 0) + amt;
    }

    return {
      year,
      income: earnings.summary,
      mileage: {
        totalMiles: mileage.totalMiles,
        totalDeduction: mileage.totalDeduction,
        irsRate: mileage.irsRate,
      },
      expenses: { total: totalExpenses, byCategory: expensesByCategory },
      notarialActs: actsCount,
      monthlyIncome: earnings.periods,
    };
  }
}
