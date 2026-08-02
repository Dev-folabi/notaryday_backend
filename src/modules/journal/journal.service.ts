import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { CreateJournalEntryDto } from './dto/journal.dto';
import { UpdateJournalEntryDto } from './dto/journal.dto';
import {
  sanitizeStrings,
  sanitizeText,
} from '../../common/utils/sanitize.util';
import { Job } from '../../../generated/prisma';

@Injectable()
export class JournalService {
  constructor(private readonly prisma: PrismaService) {}

  async createForCompletedJob(
    userId: string,
    job: Pick<
      Job,
      | 'id'
      | 'appointment_time'
      | 'address'
      | 'client_name'
      | 'fee'
      | 'signing_type'
      | 'notes'
    >,
  ) {
    const existing = await this.prisma.journalEntry.findFirst({
      where: { user_id: userId, job_id: job.id, deleted_at: null },
    });
    if (existing) return existing;

    const appointment = new Date(job.appointment_time);
    const hh = String(appointment.getUTCHours()).padStart(2, '0');
    const mm = String(appointment.getUTCMinutes()).padStart(2, '0');

    return this.prisma.journalEntry.create({
      data: {
        user_id: userId,
        job_id: job.id,
        entry_date: appointment,
        act_type: 'Acknowledgement',
        signing_type: job.signing_type,
        act_time: `${hh}:${mm}`,
        signer_name: job.client_name?.trim() || job.address || 'Client',
        address: job.address,
        fee_charged: job.fee,
        notes: job.notes ?? undefined,
      },
    });
  }

  async create(userId: string, dto: CreateJournalEntryDto) {
    const clean = sanitizeStrings(dto, 1000);
    return this.prisma.journalEntry.create({
      data: {
        user_id: userId,
        ...clean,
        entry_date: new Date(clean.entry_date),
        fee_charged: clean.fee_charged,
      },
    });
  }

  async update(userId: string, id: string, dto: UpdateJournalEntryDto) {
    await this.findOne(userId, id);
    const clean = sanitizeStrings(dto, 1000);
    return this.prisma.journalEntry.update({
      where: { id },
      data: {
        ...clean,
        entry_date: clean.entry_date ? new Date(clean.entry_date) : undefined,
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
      const search = sanitizeText(filters.search, 200);
      if (search) {
        where.OR = [
          { signer_name: { contains: search, mode: 'insensitive' } },
          { document_type: { contains: search, mode: 'insensitive' } },
          { act_type: { contains: search, mode: 'insensitive' } },
        ];
      }
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
