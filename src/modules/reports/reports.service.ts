import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../config/prisma.service';
import { JobStatus, Prisma } from '../../../generated/prisma';
import PDFDocument from 'pdfkit';
import { getLocalEmailAssets } from '../../common/email/email-assets';
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';

interface MileageRow {
  id?: string;
  jobId?: string;
  date: Date;
  address: string;
  miles: number;
  deduction: number;
  method: 'auto' | 'manual';
}

const TYPE_LABEL: Record<string, string> = {
  LOAN_REFI: 'Loan Refi',
  PURCHASE_CLOSING: 'Purchase Closing',
  HYBRID: 'Hybrid',
  GENERAL: 'General',
  FIELD_INSPECTION: 'Field Inspection',
  APOSTILLE: 'Apostille',
};

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);
  private readonly s3: S3Client | null;
  private readonly emailAssets = getLocalEmailAssets();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    const accountId = this.config.get<string>('R2_ACCOUNT_ID');
    const accessKeyId = this.config.get<string>('R2_ACCESS_KEY_ID');
    const secretAccessKey = this.config.get<string>('R2_SECRET_ACCESS_KEY');
    this.s3 =
      accountId && accessKeyId && secretAccessKey
        ? new S3Client({
            region: 'auto',
            endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
            credentials: { accessKeyId, secretAccessKey },
          })
        : null;
  }

  /** Earnings report grouped by period */
  async earnings(
    userId: string,
    from: string,
    to: string,
    groupBy: 'week' | 'month' = 'month',
    compare = false,
  ) {
    const result = await this.aggregateJobRange(userId, from, to, groupBy);

    if (!compare) return result;

    // Same window one year prior for YoY comparison
    const prevFrom = new Date(from);
    prevFrom.setFullYear(prevFrom.getFullYear() - 1);
    const prevTo = new Date(to);
    prevTo.setFullYear(prevTo.getFullYear() - 1);
    const prev = await this.aggregateJobRange(
      userId,
      prevFrom.toISOString().slice(0, 10),
      prevTo.toISOString().slice(0, 10),
      groupBy,
    );

    const pct = (cur: number, prevVal: number) =>
      prevVal > 0
        ? Math.round(((cur - prevVal) / prevVal) * 100 * 10) / 10
        : null;

    return {
      ...result,
      yoy: {
        gross: prev.summary.gross,
        net: prev.summary.net,
        grossPct: pct(result.summary.gross, prev.summary.gross),
        netPct: pct(result.summary.net, prev.summary.net),
      },
    };
  }

  private async aggregateJobRange(
    userId: string,
    from: string,
    to: string,
    groupBy: 'week' | 'month',
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

    // Group by signing type — include miles so the tax detail table can render
    const byType: Record<
      string,
      { count: number; gross: number; net: number; miles: number }
    > = {};
    for (const j of jobs) {
      const key = j.signing_type;
      if (!byType[key]) byType[key] = { count: 0, gross: 0, net: 0, miles: 0 };
      byType[key].count += 1;
      byType[key].gross += Number(j.fee);
      byType[key].net +=
        Number(j.fee) - Number(j.mileage_cost ?? 0) - Number(j.platform_fee);
      byType[key].miles += Number(j.mileage_miles ?? 0);
    }

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
        signings: jobs.length,
      },
      periods: Object.entries(periods).map(([period, data]) => ({
        period,
        ...data,
      })),
      byType: Object.entries(byType).map(([signing_type, data]) => ({
        signing_type,
        type: signing_type,
        avg: data.count > 0 ? data.gross / data.count : 0,
        ...data,
      })),
      topClients: Object.entries(clients)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([name, revenue]) => ({ name, revenue })),
    };
  }

  /** Mileage report for a year (auto-tracked jobs + manual entries) */
  async mileage(userId: string, year: number) {
    const from = new Date(`${year}-01-01`);
    const to = new Date(`${year + 1}-01-01`);

    const rows = await this.mileageInRange(userId, from, to);
    const irsRate = await this.getIrsRate(userId);

    let totalMiles = 0,
      totalDeduction = 0;
    const monthly: Record<string, { miles: number; deduction: number }> = {};

    for (const row of rows) {
      totalMiles += row.miles;
      totalDeduction += row.deduction;

      const key = `${row.date.getFullYear()}-${String(row.date.getMonth() + 1).padStart(2, '0')}`;
      if (!monthly[key]) monthly[key] = { miles: 0, deduction: 0 };
      monthly[key].miles += row.miles;
      monthly[key].deduction += row.deduction;
    }

    const autoMiles = rows
      .filter((r) => r.method === 'auto')
      .reduce((s, r) => s + r.miles, 0);
    const manualMiles = totalMiles - autoMiles;

    return {
      year,
      irsRate,
      totalMiles,
      totalDeduction,
      autoMiles,
      manualMiles,
      entries: rows.map((r) => ({
        id: r.method === 'manual' ? r.id : undefined,
        jobId: r.method === 'auto' ? r.jobId : undefined,
        date: r.date,
        job: r.address,
        miles: r.miles,
        deduction: r.deduction,
        cost: r.deduction,
        method: r.method,
      })),
      monthly: Object.entries(monthly).map(([month, data]) => ({
        month,
        ...data,
      })),
    };
  }

  /** Shared mileage aggregation for a date range (jobs = auto, MileageEntry = manual) */
  private async mileageInRange(
    userId: string,
    from: Date,
    to: Date,
  ): Promise<MileageRow[]> {
    const irsRate = await this.getIrsRate(userId);

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
        id: true,
        appointment_time: true,
        address: true,
        mileage_miles: true,
        mileage_cost: true,
      },
    });

    const manual = await this.prisma.mileageEntry.findMany({
      where: {
        user_id: userId,
        deleted_at: null,
        miles_date: { gte: from, lt: to },
      },
      orderBy: { miles_date: 'asc' },
    });

    const rows: MileageRow[] = [
      ...jobs.map((j) => {
        // Auto-tracked miles are one-way (home -> job); the deduction is the
        // round-trip cost, matching the earnings report (mileage_miles * 2 * rate).
        const oneWay = Number(j.mileage_miles);
        const roundTripCost =
          Number(j.mileage_cost ?? 0) > 0
            ? Number(j.mileage_cost)
            : oneWay * 2 * irsRate;
        return {
          jobId: j.id,
          date: j.appointment_time,
          address: j.address,
          miles: oneWay,
          deduction: roundTripCost,
          method: 'auto' as const,
        };
      }),
      ...manual.map((m) => ({
        id: m.id,
        date: m.miles_date,
        address: m.description,
        miles: Number(m.miles),
        deduction: Number(m.miles) * irsRate,
        method: 'manual' as const,
      })),
    ];

    rows.sort((a, b) => a.date.getTime() - b.date.getTime());
    return rows;
  }

  private async getIrsRate(userId: string) {
    const settings = await this.prisma.userSettings.findUnique({
      where: { user_id: userId },
      select: { irs_rate_per_mile: true },
    });
    return Number(settings?.irs_rate_per_mile ?? 0.72);
  }

  /* ---------------- Manual mileage entry CRUD ---------------- */

  async createMileageEntry(
    userId: string,
    dto: { miles_date: string; miles: number; description: string },
  ) {
    return this.prisma.mileageEntry.create({
      data: {
        user_id: userId,
        miles_date: new Date(dto.miles_date),
        miles: dto.miles,
        description: dto.description,
      },
    });
  }

  async updateMileageEntry(
    userId: string,
    id: string,
    dto: { miles_date?: string; miles?: number; description?: string },
  ) {
    await this.findOneMileageEntry(userId, id);
    return this.prisma.mileageEntry.update({
      where: { id },
      data: {
        ...(dto.miles_date && { miles_date: new Date(dto.miles_date) }),
        ...(dto.miles !== undefined && { miles: dto.miles }),
        ...(dto.description !== undefined && { description: dto.description }),
      },
    });
  }

  async deleteMileageEntry(userId: string, id: string) {
    await this.findOneMileageEntry(userId, id);
    return this.prisma.mileageEntry.update({
      where: { id },
      data: { deleted_at: new Date() },
    });
  }

  /**
   * Update an auto-tracked mileage entry by editing the underlying job's
   * mileage fields directly (no re-geocoding — the address is kept as-is).
   */
  async updateJobMileage(
    userId: string,
    jobId: string,
    dto: { miles_date?: string; miles?: number; description?: string },
  ) {
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, user_id: userId, deleted_at: null },
    });
    if (!job) throw new NotFoundException('Job not found');

    const irsRate = await this.getIrsRate(userId);
    const data: Prisma.JobUpdateInput = {};

    if (dto.miles_date) {
      const next = new Date(dto.miles_date);
      const prev = job.appointment_time ?? new Date();
      next.setHours(
        prev.getHours(),
        prev.getMinutes(),
        prev.getSeconds(),
        prev.getMilliseconds(),
      );
      data.appointment_time = next;
    }

    if (dto.miles !== undefined) {
      data.mileage_miles = dto.miles;
      data.mileage_cost =
        dto.miles > 0 ? Math.round(dto.miles * 2 * irsRate * 100) / 100 : 0;
    }

    if (dto.description !== undefined) {
      data.address = dto.description;
    }

    if (Object.keys(data).length === 0) {
      return job;
    }

    return this.prisma.job.update({ where: { id: jobId }, data });
  }

  private async findOneMileageEntry(userId: string, id: string) {
    const entry = await this.prisma.mileageEntry.findFirst({
      where: { id, user_id: userId, deleted_at: null },
    });
    if (!entry) throw new NotFoundException('Mileage entry not found');
    return entry;
  }

  /** Tax report data (JSON preview — from/to date range) */
  async taxReport(userId: string, from: string, to: string) {
    const [earnings, mileage, expenseSummary] = await Promise.all([
      this.earnings(userId, from, to, 'month'),
      this.mileageInRange(userId, new Date(from), this.dayAfter(to)),
      this.prisma.expense.findMany({
        where: {
          user_id: userId,
          deleted_at: null,
          expense_date: {
            gte: new Date(from),
            lte: this.dayAfter(to),
          },
        },
      }),
    ]);

    const year = new Date(from).getFullYear();

    const actsCount = await this.prisma.journalEntry.count({
      where: {
        user_id: userId,
        deleted_at: null,
        entry_date: {
          gte: new Date(from),
          lt: this.dayAfter(to),
        },
      },
    });

    const expensesByCategory: Record<string, number> = {};
    let totalExpenses = 0;
    for (const e of expenseSummary) {
      const amt = Number(e.amount);
      totalExpenses += amt;
      expensesByCategory[e.category] =
        (expensesByCategory[e.category] ?? 0) + amt;
    }

    const autoMiles = mileage
      .filter((r) => r.method === 'auto')
      .reduce((s, r) => s + r.miles, 0);
    const manualMiles = mileage
      .filter((r) => r.method === 'manual')
      .reduce((s, r) => s + r.miles, 0);
    const totalMiles = autoMiles + manualMiles;
    const irsRate = await this.getIrsRate(userId);
    // Auto rows already carry the round-trip cost (mileage_cost); manual rows
    // are one-way at the IRS rate — consistent with the Mileage report.
    const totalDeduction = mileage.reduce((s, r) => s + r.deduction, 0);

    return {
      year,
      from,
      to,
      income: earnings.summary,
      byType: earnings.byType,
      mileage: {
        totalMiles,
        totalDeduction,
        irsRate,
        autoMiles,
        manualMiles,
        autoPct:
          totalMiles > 0 ? Math.round((autoMiles / totalMiles) * 1000) / 10 : 0,
        manualPct:
          totalMiles > 0
            ? Math.round((manualMiles / totalMiles) * 1000) / 10
            : 0,
      },
      expenses: { total: totalExpenses, byCategory: expensesByCategory },
      notarialActs: actsCount,
      monthlyIncome: earnings.periods,
    };
  }

  async taxPdf(
    userId: string,
    from: string,
    to: string,
    regenerate = false,
  ): Promise<Buffer> {
    const cacheKey = this.taxPdfKey(userId, from, to);

    if (!regenerate && this.s3) {
      const cached = await this.fetchTaxPdf(cacheKey);
      if (cached) return cached;
    }

    const buffer = await this.generateScheduleCPdf(userId, from, to);

    if (this.s3) {
      await this.storeTaxPdf(cacheKey, buffer).catch((err: unknown) => {
        this.logger.warn(
          `Tax PDF upload to R2 failed (${cacheKey}): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
    }

    return buffer;
  }

  private taxPdfKey(userId: string, from: string, to: string) {
    return `tax-pdfs/${userId}/${from}_${to}.pdf`;
  }

  private async fetchTaxPdf(key: string): Promise<Buffer | null> {
    if (!this.s3) return null;
    const bucket = this.config.get<string>('R2_BUCKET_NAME');
    try {
      const result = await this.s3.send(
        new GetObjectCommand({ Bucket: bucket, Key: key }),
      );
      if (!result.Body) return null;
      return Buffer.from(await result.Body.transformToByteArray());
    } catch {
      return null; // not cached yet — generate it
    }
  }

  private async storeTaxPdf(key: string, buffer: Buffer) {
    if (!this.s3) return;
    const bucket = this.config.get<string>('R2_BUCKET_NAME');
    await this.s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: buffer,
        ContentType: 'application/pdf',
        Metadata: { generated_at: new Date().toISOString() },
      }),
    );
  }

  private async generateScheduleCPdf(
    userId: string,
    from: string,
    to: string,
  ): Promise<Buffer> {
    const data = await this.taxReport(userId, from, to);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { full_name: true, credentials: true, nna_certified: true },
    });

    const name = user?.full_name ?? 'Notary';
    const credLine = [
      ...(user?.credentials ?? []),
      ...(user?.nna_certified ? ['NNA Certified'] : []),
    ];
    const subtitle = `${name}${credLine.length ? `, ${credLine.join(', ')}` : ''}, Tax Year ${data.year}, Detailed`;

    const income = data.income;
    const gross = Number(income?.gross ?? 0);
    const net = Number(income?.net ?? 0);
    const expensesTotal = Number(data.expenses.total ?? 0);
    const m = data.mileage;
    const byType = data.byType ?? [];

    const money = (v: number) => `$${v.toFixed(2)}`;

    return new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50, bufferPages: true });
      const chunks: Buffer[] = [];
      doc.on('data', (c) => chunks.push(c as Buffer));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);


      const contentFloor = doc.page.height - 128;
      let pageNo = 1;

      // Header — navy Schedule C banner (redrawn on every page)
      const drawHeader = () => {
        doc.rect(0, 0, doc.page.width, 88).fill('#0F2C4E');
        doc.fill('#FFFFFF');
        const titleX = 50;
        const titleWidth = doc.page.width - titleX - 50;
        let logoDrawn = false;
        if (this.emailAssets.whiteText) {
          try {
            doc.image(this.emailAssets.whiteText, 50, 22, { width: 140 });
            logoDrawn = true;
          } catch {
            /* fall through to full-width title */
          }
        }
        if (logoDrawn) {
          doc
            .fontSize(15)
            .font('Helvetica-Bold')
            .text('Schedule C, Notary Income Summary', 210, 24, {
              width: titleWidth - 160,
            });
          doc
            .fontSize(10)
            .font('Helvetica')
            .fillColor('#B8C7DD')
            .text(subtitle, 210, 48, { width: titleWidth - 160 });
        } else {
          doc
            .fontSize(16)
            .font('Helvetica-Bold')
            .text('Schedule C, Notary Income Summary', titleX, 28);
          doc
            .fontSize(10)
            .font('Helvetica')
            .fillColor('#B8C7DD')
            .text(subtitle, titleX, 52);
        }
        doc.fill('#0F2C4E');
      };

      // Footer — generation stamp + disclaimer, kept inside the printable area
      const drawFooter = () => {
        let textX = 170;
        let logoDrawn = false;
        if (this.emailAssets.original) {
          try {
            doc.image(this.emailAssets.original, 50, contentFloor + 6, {
              width: 96,
            });
            logoDrawn = true;
          } catch {
            textX = 50;
          }
        }
        if (!logoDrawn) {
          doc
            .fontSize(9)
            .font('Helvetica')
            .fillColor('#64748B')
            .text('Powered by Notary Day', 50, contentFloor + 14);
        }
        doc
          .fontSize(9)
          .font('Helvetica')
          .fillColor('#64748B')
          .text(
            `Generated by Notary Day, ${new Date().toLocaleDateString()} — Page ${pageNo}`,
            textX,
            contentFloor + 14,
          );
        doc
          .fontSize(9)
          .fillColor('#94A3B8')
          .text(
            'For informational purposes only — not tax advice. Consult your accountant.',
            textX,
            contentFloor + 30,
            { width: 380 },
          );
        doc.fill('#0F2C4E');
      };

      drawHeader();

      let y = 120;
      // Start a new page (with header + footer) when the next block won't fit.
      const ensureSpace = (needed: number) => {
        if (y + needed > contentFloor) {
          doc.addPage();
          pageNo += 1;
          drawHeader();
          drawFooter();
          y = 120;
        }
      };
      const section = (title: string) => {
        ensureSpace(24);
        doc
          .fontSize(9)
          .font('Helvetica-Bold')
          .fillColor('#64748B')
          .text(title.toUpperCase(), 50, y);
        y += 14;
        doc
          .moveTo(50, y)
          .lineTo(doc.page.width - 50, y)
          .strokeColor('#E2E8F0')
          .stroke();
        y += 4;
      };
      const line = (label: string, value: string, color = '#0F2C4E') => {
        ensureSpace(22);
        doc
          .fontSize(10)
          .font('Helvetica')
          .fillColor('#475569')
          .text(label, 50, y + 2, { width: 340 });
        doc
          .font('Helvetica-Bold')
          .fillColor(color)
          .text(value, 390, y + 2, { align: 'right' });
        y += 18;
        doc
          .moveTo(50, y)
          .lineTo(doc.page.width - 50, y)
          .strokeColor('#E2E8F0')
          .stroke();
        y += 2;
      };

      // Income summary
      section('Income summary');
      line(
        `Total gross income (${income?.signings ?? 0} signings)`,
        money(gross),
      );
      line(
        `Total mileage expense (${m.totalMiles.toFixed(0)} mi at $${m.irsRate})`,
        `-${money(m.totalDeduction)}`,
        '#D97706',
      );
      line(
        'Total other expenses (software, supplies, pro dev)',
        `-${money(expensesTotal)}`,
        '#D97706',
      );
      line('Net self employment income', money(net), '#0E7B6C');

      y += 10;
      section('By signing type, detailed');
      // Table header — the type column is wider so long signing types render on
      // one line instead of wrapping under the next row's divider (which
      // appeared as a strike-through).
      const colX = [50, 195, 255, 320, 395, 455];
      const colW = [140, 55, 60, 70, 55, 75];
      const hdr = [
        'Type',
        'Count',
        'Gross',
        'Avg per signing',
        'Mileage',
        'Net',
      ];
      ensureSpace(26);
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#0F2C4E');
      hdr.forEach((h, i) => {
        doc.text(h, colX[i], y + 3, {
          width: colW[i],
          align: i >= 1 ? 'right' : 'left',
        });
      });
      y += 18;
      doc
        .moveTo(50, y)
        .lineTo(doc.page.width - 50, y)
        .strokeColor('#CBD5E1')
        .stroke();
      y += 6;
      doc.fontSize(9).font('Helvetica').fillColor('#475569');
      for (const t of byType) {
        const typeText =
          TYPE_LABEL[String(t.type ?? '').toUpperCase()] ??
          String(t.type ?? 'Other');
        const typeHeight =
          doc.heightOfString(typeText, { width: colW[0] }) || 12;
        const rowH = Math.max(typeHeight, 16);
        ensureSpace(rowH + 4);
        const cells = [
          typeText,
          String(t.count ?? 0),
          money(Number(t.gross ?? 0)),
          money(Number(t.avg ?? 0)),
          `${Number(t.miles ?? 0).toFixed(0)} mi`,
          money(Number(t.net ?? 0)),
        ];
        cells.forEach((c, i) => {
          doc.text(c, colX[i], y + 3, {
            width: colW[i],
            align: i >= 1 ? 'right' : 'left',
          });
        });
        y += rowH;
        doc
          .moveTo(50, y)
          .lineTo(doc.page.width - 50, y)
          .strokeColor('#E2E8F0')
          .stroke();
        y += 2;
      }

      y += 8;
      section('Mileage deduction detail');
      line('Total business miles driven', `${m.totalMiles.toFixed(0)} mi`);
      line(`IRS standard mileage rate ${data.year}`, `$${m.irsRate}/mile`);
      line('Total deductible mileage expense', money(m.totalDeduction));
      line(
        'Auto tracked miles',
        `${m.autoMiles.toFixed(0)} mi (${m.autoPct}%)`,
      );
      line(
        'Manually entered miles',
        `${m.manualMiles.toFixed(0)} mi (${m.manualPct}%)`,
      );

      y += 14;
      ensureSpace(30);
      doc
        .fontSize(14)
        .font('Helvetica-Bold')
        .fillColor('#0F2C4E')
        .text(`Net self employment income: ${money(net)}`, 50, y);

      drawFooter();
      doc.end();
    });
  }

  private dayAfter(dateStr: string): Date {
    const d = new Date(dateStr);
    d.setDate(d.getDate() + 1);
    return d;
  }
}
