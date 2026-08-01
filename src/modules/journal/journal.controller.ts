import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { AuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JournalService } from './journal.service';
import {
  CreateJournalEntryDto,
  UpdateJournalEntryDto,
} from './dto/journal.dto';

@ApiTags('Journal')
@ApiBearerAuth()
@Controller('journal')
@UseGuards(AuthGuard)
export class JournalController {
  constructor(private readonly journal: JournalService) {}

  @Post()
  @ApiOperation({ summary: 'Create a notarial journal entry' })
  @ApiResponse({ status: 201, description: 'Journal entry created' })
  async create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateJournalEntryDto,
  ) {
    return { success: true, data: await this.journal.create(userId, dto) };
  }

  @Get()
  @ApiOperation({ summary: 'List journal entries with optional filters' })
  @ApiQuery({ name: 'from', required: false, example: '2025-01-01' })
  @ApiQuery({ name: 'to', required: false, example: '2025-12-31' })
  @ApiQuery({
    name: 'search',
    required: false,
    description: 'Search by signer name or document type',
  })
  @ApiResponse({ status: 200, description: 'Array of journal entries' })
  async findAll(
    @CurrentUser('id') userId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('search') search?: string,
  ) {
    return {
      success: true,
      data: await this.journal.findAll(userId, { from, to, search }),
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single journal entry' })
  @ApiParam({ name: 'id', description: 'Journal entry UUID' })
  @ApiResponse({ status: 200, description: 'Journal entry object' })
  @ApiResponse({ status: 404, description: 'Entry not found' })
  async findOne(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return { success: true, data: await this.journal.findOne(userId, id) };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a journal entry' })
  @ApiParam({ name: 'id', description: 'Journal entry UUID' })
  @ApiResponse({ status: 200, description: 'Journal entry updated' })
  @ApiResponse({ status: 404, description: 'Entry not found' })
  async update(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateJournalEntryDto,
  ) {
    return { success: true, data: await this.journal.update(userId, id, dto) };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a journal entry' })
  @ApiParam({ name: 'id', description: 'Journal entry UUID' })
  @ApiResponse({ status: 204, description: 'Entry deleted' })
  async remove(@CurrentUser('id') userId: string, @Param('id') id: string) {
    await this.journal.remove(userId, id);
  }
}
