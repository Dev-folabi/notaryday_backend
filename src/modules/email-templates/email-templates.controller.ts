import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { AuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { EmailTemplatesService } from './email-templates.service';
import {
  CreateEmailTemplateDto,
  UpdateEmailTemplateDto,
} from './dto/email-template.dto';

@ApiTags('Email Templates')
@ApiBearerAuth()
@Controller('email-templates')
@UseGuards(AuthGuard)
export class EmailTemplatesController {
  constructor(private readonly templates: EmailTemplatesService) {}

  @Get()
  @ApiOperation({ summary: 'List all email templates for the current user' })
  @ApiResponse({ status: 200, description: 'Array of email templates' })
  async findAll(@CurrentUser('id') userId: string) {
    return { success: true, data: await this.templates.findAll(userId) };
  }

  @Get(':type')
  @ApiOperation({ summary: 'Get a specific email template by type' })
  @ApiParam({
    name: 'type',
    example: 'invoice_reminder',
    description: 'Template type identifier',
  })
  @ApiResponse({ status: 200, description: 'Email template object' })
  @ApiResponse({ status: 404, description: 'Template not found' })
  async findByType(
    @CurrentUser('id') userId: string,
    @Param('type') type: string,
  ) {
    return {
      success: true,
      data: await this.templates.findByType(userId, type),
    };
  }

  @Post()
  @ApiOperation({ summary: 'Create a custom email template' })
  @ApiResponse({ status: 201, description: 'Template created' })
  async create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateEmailTemplateDto,
  ) {
    return { success: true, data: await this.templates.create(userId, dto) };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an email template' })
  @ApiParam({ name: 'id', description: 'Template UUID' })
  @ApiResponse({ status: 200, description: 'Updated template' })
  async update(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateEmailTemplateDto,
  ) {
    return {
      success: true,
      data: await this.templates.update(userId, id, dto),
    };
  }

  @Post(':type/reset')
  @ApiOperation({ summary: 'Reset a template to its default content' })
  @ApiParam({ name: 'type', example: 'invoice_reminder' })
  @ApiResponse({ status: 200, description: 'Template reset to default' })
  async reset(@CurrentUser('id') userId: string, @Param('type') type: string) {
    return {
      success: true,
      data: await this.templates.resetToDefault(userId, type),
    };
  }
}
