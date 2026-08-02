import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiBody,
  ApiConsumes,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '../../common/guards/auth.guard';
import { PlanGuard } from '../../common/guards/plan.guard';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequiresPro } from '../../common/decorators/requires-pro.decorator';
import { JobImportService } from './job-import.service';

@ApiTags('Job Import')
@ApiBearerAuth()
@Controller('imports')
@UseGuards(AuthGuard, PlanGuard)
export class JobImportController {
  constructor(private readonly jobImport: JobImportService) {}

  @Post('inbound')
  @Public()
  @ApiOperation({ summary: 'Inbound email webhook (called by Resend)' })
  @ApiBody({
    schema: {
      properties: {
        type: { type: 'string' },
        data: {
          type: 'object',
          properties: {
            email_id: { type: 'string' },
            from: { type: 'string' },
            to: { type: 'array', items: { type: 'string' } },
            bcc: { type: 'array', items: { type: 'string' } },
            subject: { type: 'string' },
            message_id: { type: 'string' },
          },
        },
        from: { type: 'string' },
        subject: { type: 'string' },
        text: { type: 'string' },
        html: { type: 'string' },
        messageId: { type: 'string' },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Email parsed and queued for processing',
  })
  async handleInbound(
    @Body()
    body: {
      // Resend email.received webhook envelope
      type?: string;
      data?: {
        email_id?: string;
        from?: string;
        to?: string[];
        cc?: string[];
        bcc?: string[];
        subject?: string;
        message_id?: string;
      };
      // Legacy flat payload (kept for backward compat)
      from?: string;
      sender?: string;
      to?: string | string[];
      bcc?: string | string[];
      subject?: string;
      text?: string;
      plain?: string;
      html?: string;
      messageId?: string;
      message_id?: string;
    },
  ) {
    const data = body.data ?? {};
    const result = await this.jobImport.handleInbound({
      from: data.from ?? body.from ?? body.sender ?? '',
      to: data.to ?? this.toArray(body.to),
      bcc: data.bcc ?? this.toArray(body.bcc),
      subject: data.subject ?? body.subject,
      text: body.text ?? body.plain ?? '',
      html: body.html,
      emailId: data.email_id,
      messageId:
        data.message_id ??
        body.messageId ??
        body.message_id ??
        `msg-${Date.now()}`,
    });
    return { success: true, data: result };
  }

  private toArray(value: string | string[] | undefined): string[] {
    if (!value) return [];
    return Array.isArray(value) ? value : [value];
  }

  @Post('upload')
  @RequiresPro()
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({
    summary: 'Upload a screenshot to parse job details via OCR (Pro only)',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'Screenshot image file (PNG, JPG, PDF)',
        },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Parsed job data from screenshot' })
  @ApiResponse({ status: 400, description: 'Invalid file or unable to parse' })
  @ApiResponse({ status: 403, description: 'Pro subscription required' })
  async upload(@CurrentUser('id') userId: string, @UploadedFile() file: any) {
    const result = await this.jobImport.handleUpload(userId, file);
    return { success: true, data: result };
  }

  @Get()
  @RequiresPro()
  @ApiOperation({ summary: 'List all job imports for the current user' })
  @ApiResponse({ status: 200, description: 'Array of job import records' })
  @ApiResponse({ status: 403, description: 'Pro subscription required' })
  async findAll(@CurrentUser('id') userId: string) {
    const imports = await this.jobImport.findAll(userId);
    return { success: true, data: imports };
  }

  @Get(':id')
  @RequiresPro()
  @ApiOperation({ summary: 'Get a single job import by ID' })
  @ApiParam({ name: 'id', description: 'Job import UUID' })
  @ApiResponse({
    status: 200,
    description: 'Job import record with parsed data',
  })
  @ApiResponse({ status: 404, description: 'Import not found' })
  async findOne(@CurrentUser('id') userId: string, @Param('id') id: string) {
    const record = await this.jobImport.findOne(userId, id);
    return { success: true, data: record };
  }

  @Post(':id/confirm')
  @RequiresPro()
  @ApiOperation({
    summary: 'Confirm a parsed job import and create a job from it',
  })
  @ApiParam({ name: 'id', description: 'Job import UUID' })
  @ApiBody({
    schema: {
      description: 'Optional field overrides for the created job',
      type: 'object',
      additionalProperties: true,
    },
  })
  @ApiResponse({ status: 201, description: 'Job created from import' })
  @ApiResponse({ status: 403, description: 'Pro subscription required' })
  async confirm(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() overrides: Record<string, any>,
  ) {
    const job = await this.jobImport.confirm(userId, id, overrides);
    return { success: true, data: job };
  }

  @Post(':id/decline')
  @RequiresPro()
  @ApiOperation({ summary: 'Decline a parsed job import' })
  @ApiParam({ name: 'id', description: 'Job import UUID' })
  @ApiResponse({ status: 200, description: 'Import declined' })
  @ApiResponse({ status: 404, description: 'Import not found' })
  @ApiResponse({ status: 403, description: 'Pro subscription required' })
  async decline(@CurrentUser('id') userId: string, @Param('id') id: string) {
    const result = await this.jobImport.decline(userId, id);
    return { success: true, data: result };
  }
}
