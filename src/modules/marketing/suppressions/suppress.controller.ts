import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { AuthGuard } from '../../../common/guards/auth.guard';
import { AdminGuard } from '../../../common/guards/admin.guard';
import { SuppressService } from './suppress.service';
import { CreateSuppressionDto } from '../dto/campaign.dto';

@ApiTags('Marketing Suppressions')
@ApiBearerAuth()
@Controller('marketing/suppressions')
@UseGuards(AuthGuard, AdminGuard)
export class SuppressController {
  constructor(private readonly suppress: SuppressService) {}

  @Get()
  @ApiOperation({
    summary: 'Suppression list (unsubscribes/bounces/complaints)',
  })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({
    name: 'type',
    required: false,
    enum: ['UNSUBSCRIBE', 'BOUNCE', 'COMPLAINT', 'MANUAL'],
  })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async list(
    @Query('search') search?: string,
    @Query('type') type?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    const result = await this.suppress.list({
      search,
      type,
      page: Number(page) || 1,
      limit: Number(limit) || 20,
    });
    return { success: true, ...result };
  }

  @Post()
  @ApiOperation({ summary: 'Manually suppress an email address' })
  async create(@Body() dto: CreateSuppressionDto) {
    return {
      success: true,
      data: await this.suppress.create(dto as never),
    };
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Remove a suppression (re-subscribe; queued sends unblocked)',
  })
  async remove(@Param('id') id: string) {
    return { success: true, data: await this.suppress.remove(id) };
  }
}
