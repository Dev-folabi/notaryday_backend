import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthGuard } from '../../../common/guards/auth.guard';
import { AdminGuard } from '../../../common/guards/admin.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { ImportsService } from './imports.service';
import { SaveMappingDto, StartImportDto } from '../dto/import.dto';

@ApiTags('Marketing Imports')
@ApiBearerAuth()
@Controller('marketing/imports')
@UseGuards(AuthGuard, AdminGuard)
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload a lead spreadsheet (.xlsx/.csv) and inspect its headers',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Import job + suggested mapping' })
  @ApiResponse({ status: 400, description: 'Invalid file' })
  async upload(
    @CurrentUser('id') userId: string,
    @UploadedFile()
    file: {
      originalname: string;
      buffer: Buffer;
      mimetype: string;
      size: number;
    },
  ) {
    if (!file) {
      throw new BadRequestException('file field is required');
    }
    const result = await this.imports.upload(file, userId);
    return { success: true, data: result };
  }

  @Get('mappings')
  @ApiOperation({ summary: 'List saved column-mapping presets' })
  async listPresets() {
    return { success: true, data: await this.imports.listPresets() };
  }

  @Get()
  @ApiOperation({ summary: 'List recent import jobs' })
  async list() {
    return { success: true, data: await this.imports.list() };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Import job detail (poll while processing)' })
  @ApiResponse({ status: 404, description: 'Import not found' })
  async detail(@Param('id') id: string) {
    return { success: true, data: await this.imports.detail(id) };
  }

  @Patch(':id/mapping')
  @ApiOperation({ summary: 'Save column mapping for an upload' })
  async saveMapping(@Param('id') id: string, @Body() dto: SaveMappingDto) {
    return { success: true, data: await this.imports.saveMapping(id, dto) };
  }

  @Post(':id/mapping/apply-preset')
  @ApiOperation({ summary: 'Apply a saved mapping preset to an upload' })
  async applyPreset(
    @Param('id') id: string,
    @Body() dto: { presetId: string },
  ) {
    if (!dto?.presetId) {
      throw new BadRequestException('presetId is required');
    }
    return {
      success: true,
      data: await this.imports.applyPreset(id, dto.presetId),
    };
  }

  @Post(':id/start')
  @ApiOperation({ summary: 'Queue the import for processing by the worker' })
  async start(@Param('id') id: string, @Body() dto: StartImportDto) {
    return { success: true, data: await this.imports.start(id, dto) };
  }
}
