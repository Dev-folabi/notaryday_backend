import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { CreateJournalEntryDto } from './dto/journal.dto';

@Injectable()
export class JournalService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateJournalEntryDto) {
    return this.prisma.journalEntry.create({
      data: {
        user_id: userId,
        ...dto,
        entry_date: new Date(dto.entry_date),
        fee_charged: dto.fee_charged,
      },
    });
  }

  async findAll(
    userId: string,
    filters?: { from?: string; to?: string; search?: string },
  ) {
    const where: any = { user_id: userId, deleted_at: null };
    if (filters?.from || filters?.to) {
      where.entry_date = {};
      if (filters.from) where.entry_date.gte = new Date(filters.from);
      if (filters.to) where.entry_date.lte = new Date(filters.to);
    }
    if (filters?.search) {
      where.OR = [
        { signer_name: { contains: filters.search, mode: 'insensitive' } },
        { document_type: { contains: filters.search, mode: 'insensitive' } },
        { act_type: { contains: filters.search, mode: 'insensitive' } },
      ];
    }
    return this.prisma.journalEntry.findMany({
      where,
      orderBy: { entry_date: 'desc' },
      take: 200,
    });
  }

  async findOne(userId: string, id: string) {
    const entry = await this.prisma.journalEntry.findFirst({
      where: { id, user_id: userId, deleted_at: null },
    });
    if (!entry) throw new NotFoundException('Journal entry not found');
    return entry;
  }

  async remove(userId: string, id: string) {
    await this.findOne(userId, id);
    return this.prisma.journalEntry.update({
      where: { id },
      data: { deleted_at: new Date() },
    });
  }
}
