import { Controller, Get, Post, Param, Body, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiBody,
} from '@nestjs/swagger';
import { AuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { EmailImportService } from './email-import.service';

@ApiTags('Email Import')
@Controller('email-import')
export class EmailImportController {
  constructor(private readonly emailImport: EmailImportService) {}

  @Post('inbound')
  @ApiOperation({ summary: 'Inbound email webhook (called by Resend)' })
  @ApiBody({
    schema: {
      properties: {
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
      from?: string;
      sender?: string;
      subject?: string;
      text?: string;
      plain?: string;
      html?: string;
      messageId?: string;
      message_id?: string;
    },
  ) {
    const result = await this.emailImport.handleInbound({
      from: body.from ?? body.sender ?? '',
      subject: body.subject,
      text: body.text ?? body.plain ?? '',
      html: body.html,
      messageId: body.messageId ?? body.message_id ?? `msg-${Date.now()}`,
    });
    return { success: true, data: result };
  }

  @Get()
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all email imports for the current user' })
  @ApiResponse({ status: 200, description: 'Array of email import records' })
  async findAll(@CurrentUser('id') userId: string) {
    const imports = await this.emailImport.findAll(userId);
    return { success: true, data: imports };
  }

  @Get(':id')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get a single email import by ID' })
  @ApiParam({ name: 'id', description: 'Email import UUID' })
  @ApiResponse({
    status: 200,
    description: 'Email import record with parsed data',
  })
  @ApiResponse({ status: 404, description: 'Import not found' })
  async findOne(@CurrentUser('id') userId: string, @Param('id') id: string) {
    const record = await this.emailImport.findOne(userId, id);
    return { success: true, data: record };
  }

  @Post(':id/confirm')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Confirm a parsed email import and create a job from it',
  })
  @ApiParam({ name: 'id', description: 'Email import UUID' })
  @ApiBody({
    schema: {
      description: 'Optional field overrides for the created job',
      type: 'object',
      additionalProperties: true,
    },
  })
  @ApiResponse({ status: 201, description: 'Job created from email import' })
  async confirm(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() overrides: Record<string, any>,
  ) {
    const job = await this.emailImport.confirm(userId, id, overrides);
    return { success: true, data: job };
  }
}
