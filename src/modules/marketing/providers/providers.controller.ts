import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthGuard } from '../../../common/guards/auth.guard';
import { AdminGuard } from '../../../common/guards/admin.guard';
import { ProvidersService } from './providers.service';
import { CreateProviderDto } from '../dto/create-provider.dto';
import { UpdateProviderDto } from '../dto/update-provider.dto';
import { TestProviderDto } from '../dto/test-provider.dto';

@ApiTags('Marketing Providers')
@ApiBearerAuth()
@Controller('marketing/providers')
@UseGuards(AuthGuard, AdminGuard)
export class ProvidersController {
  constructor(private readonly providers: ProvidersService) {}

  @Get()
  @ApiOperation({
    summary: 'List email providers (credentials never returned)',
  })
  async list() {
    return { success: true, data: await this.providers.findAll() };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one provider' })
  @ApiResponse({ status: 404, description: 'Provider not found' })
  async detail(@Param('id') id: string) {
    return { success: true, data: await this.providers.findOne(id) };
  }

  @Post()
  @ApiOperation({ summary: 'Add an email provider account' })
  async create(@Body() dto: CreateProviderDto) {
    return { success: true, data: await this.providers.create(dto) };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update provider settings / credentials' })
  async update(@Param('id') id: string, @Body() dto: UpdateProviderDto) {
    return { success: true, data: await this.providers.update(id, dto) };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove a provider account' })
  async remove(@Param('id') id: string) {
    return { success: true, data: await this.providers.remove(id) };
  }

  @Post(':id/test')
  @ApiOperation({
    summary: 'Send a test email through this provider (sync result)',
  })
  async test(@Param('id') id: string, @Body() dto: TestProviderDto) {
    return { success: true, data: await this.providers.sendTest(id, dto) };
  }
}
