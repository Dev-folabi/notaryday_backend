import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  OutreachTask,
  OutreachTaskDocument,
} from '../schemas/outreach-task.schema';
import { Lead, LeadDocument } from '../schemas/lead.schema';
import { TASK_STATUSES } from '../marketing.constants';

@Injectable()
export class OutreachTasksService {
  constructor(
    @InjectModel(OutreachTask.name)
    private readonly taskModel: Model<OutreachTaskDocument>,
    @InjectModel(Lead.name) private readonly leadModel: Model<LeadDocument>,
  ) {}

  async list(filters: {
    status?: string;
    channel?: string;
    search?: string;
    page: number;
    limit: number;
  }) {
    const query: Record<string, unknown> = {};
    if (filters.status) query.status = filters.status;
    if (filters.channel) query.channel = filters.channel;
    let leadFilter: Record<string, unknown> | null = null;
    if (filters.search) {
      const rx = new RegExp(
        filters.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        'i',
      );
      leadFilter = { businessName: rx };
    }

    const page = Math.max(1, filters.page);
    const limit = Math.min(200, Math.max(1, filters.limit));

    // Search needs a lead join — resolve matching lead ids first
    let leadIds: Types.ObjectId[] | undefined;
    if (leadFilter) {
      const leads = await this.leadModel
        .find(leadFilter)
        .select('_id')
        .lean<{ _id: Types.ObjectId }[]>()
        .limit(5000)
        .exec();
      leadIds = leads.map((l) => l._id);
      if (leadIds.length === 0) {
        return { data: [], meta: { page, limit, total: 0, totalPages: 1 } };
      }
      query.leadRef = { $in: leadIds };
    }

    const total = await this.taskModel.countDocuments(query);
    const tasks = await this.taskModel
      .find(query)
      .sort({ status: 1, createdAt: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .exec();

    // Attach lead context
    const leadMap = new Map<string, Partial<LeadDocument>>();
    const uniqueLeadIds = [...new Set(tasks.map((t) => String(t.leadRef)))];
    if (uniqueLeadIds.length > 0) {
      const leads = await this.leadModel
        .find({ _id: { $in: uniqueLeadIds } })
        .select(
          'businessName email state instagramUrl facebookUrl phone leadId',
        )
        .exec();
      for (const lead of leads) leadMap.set(String(lead._id), lead);
    }

    const data = tasks.map((task) => {
      const lead = leadMap.get(String(task.leadRef));
      return {
        ...task.toObject(),
        lead: lead
          ? {
              _id: String(lead._id),
              businessName: lead.businessName,
              email: lead.email,
              state: lead.state,
              instagramUrl: lead.instagramUrl,
              facebookUrl: lead.facebookUrl,
              phone: lead.phone,
              leadId: lead.leadId,
            }
          : null,
      };
    });

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

  async update(
    id: string,
    dto: { status?: string; dueDate?: string | null; notes?: string },
  ) {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Task not found');
    }
    const update: Record<string, unknown> = {};
    if (dto.status !== undefined) {
      if (!TASK_STATUSES.includes(dto.status as never)) {
        throw new BadRequestException(`Invalid status "${dto.status}"`);
      }
      update.status = dto.status;
      update.completedAt = dto.status === 'DONE' ? new Date() : null;
    }
    if (dto.dueDate !== undefined) {
      update.dueDate = dto.dueDate ? new Date(dto.dueDate) : null;
    }
    if (dto.notes !== undefined) update.notes = dto.notes;
    const task = await this.taskModel
      .findByIdAndUpdate(id, { $set: update }, { new: true })
      .exec();
    if (!task) throw new NotFoundException('Task not found');
    return task;
  }

  async remove(id: string): Promise<{ deleted: true }> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Task not found');
    }
    const task = await this.taskModel.findByIdAndDelete(id).exec();
    if (!task) throw new NotFoundException('Task not found');
    return { deleted: true };
  }
}
