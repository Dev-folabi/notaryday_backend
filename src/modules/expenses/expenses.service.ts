import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { CreateExpenseDto, UpdateExpenseDto } from './dto/expense.dto';

@Injectable()
export class ExpensesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateExpenseDto) {
    return this.prisma.expense.create({
      data: {
        user_id: userId,
        ...dto,
        expense_date: new Date(dto.expense_date),
      },
    });
  }

  async findAll(
    userId: string,
    filters?: { category?: string; from?: string; to?: string },
  ) {
    const where: any = { user_id: userId, deleted_at: null };
    if (filters?.category) where.category = filters.category;
    if (filters?.from || filters?.to) {
      where.expense_date = {};
      if (filters.from) where.expense_date.gte = new Date(filters.from);
      if (filters.to) where.expense_date.lte = new Date(filters.to);
    }
    return this.prisma.expense.findMany({
      where,
      orderBy: { expense_date: 'desc' },
    });
  }

  async findOne(userId: string, id: string) {
    const expense = await this.prisma.expense.findFirst({
      where: { id, user_id: userId, deleted_at: null },
    });
    if (!expense) throw new NotFoundException('Expense not found');
    return expense;
  }

  async update(userId: string, id: string, dto: UpdateExpenseDto) {
    await this.findOne(userId, id);
    return this.prisma.expense.update({
      where: { id },
      data: {
        ...dto,
        ...(dto.expense_date && { expense_date: new Date(dto.expense_date) }),
      },
    });
  }

  async remove(userId: string, id: string) {
    await this.findOne(userId, id);
    return this.prisma.expense.update({
      where: { id },
      data: { deleted_at: new Date() },
    });
  }

  async getSummary(userId: string, year: number) {
    const from = new Date(`${year}-01-01`);
    const to = new Date(`${year + 1}-01-01`);
    const expenses = await this.prisma.expense.findMany({
      where: {
        user_id: userId,
        deleted_at: null,
        expense_date: { gte: from, lt: to },
      },
    });
    const byCategory: Record<string, number> = {};
    let total = 0;
    for (const e of expenses) {
      const amt = Number(e.amount);
      total += amt;
      byCategory[e.category] = (byCategory[e.category] ?? 0) + amt;
    }
    return { total, byCategory, count: expenses.length };
  }
}
