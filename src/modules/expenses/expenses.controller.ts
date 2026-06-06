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
import { ExpensesService } from './expenses.service';
import { CreateExpenseDto, UpdateExpenseDto } from './dto/expense.dto';
import { ExpenseCategory } from '../../../generated/prisma';

@ApiTags('Expenses')
@ApiBearerAuth()
@Controller('expenses')
@UseGuards(AuthGuard)
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new expense' })
  @ApiResponse({ status: 201, description: 'Expense created' })
  async create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateExpenseDto,
  ) {
    return { success: true, data: await this.expenses.create(userId, dto) };
  }

  @Get()
  @ApiOperation({ summary: 'List expenses with optional filters' })
  @ApiQuery({ name: 'category', required: false, enum: ExpenseCategory })
  @ApiQuery({
    name: 'from',
    required: false,
    example: '2025-01-01',
    description: 'Start date filter',
  })
  @ApiQuery({
    name: 'to',
    required: false,
    example: '2025-12-31',
    description: 'End date filter',
  })
  @ApiResponse({ status: 200, description: 'Array of expenses' })
  async findAll(
    @CurrentUser('id') userId: string,
    @Query('category') category?: ExpenseCategory,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const data = await this.expenses.findAll(userId, { category, from, to });
    return { success: true, data };
  }

  @Get('summary')
  @ApiOperation({ summary: 'Get expense summary by category for a year' })
  @ApiQuery({ name: 'year', required: false, example: '2025' })
  @ApiResponse({
    status: 200,
    description: 'Expense totals grouped by category',
  })
  async getSummary(
    @CurrentUser('id') userId: string,
    @Query('year') year?: string,
  ) {
    const y = year ? parseInt(year) : new Date().getFullYear();
    return { success: true, data: await this.expenses.getSummary(userId, y) };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single expense by ID' })
  @ApiParam({ name: 'id', description: 'Expense UUID' })
  @ApiResponse({ status: 200, description: 'Expense object' })
  @ApiResponse({ status: 404, description: 'Expense not found' })
  async findOne(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return { success: true, data: await this.expenses.findOne(userId, id) };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an expense' })
  @ApiParam({ name: 'id', description: 'Expense UUID' })
  @ApiResponse({ status: 200, description: 'Updated expense' })
  async update(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateExpenseDto,
  ) {
    return { success: true, data: await this.expenses.update(userId, id, dto) };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an expense' })
  @ApiParam({ name: 'id', description: 'Expense UUID' })
  @ApiResponse({ status: 204, description: 'Expense deleted' })
  async remove(@CurrentUser('id') userId: string, @Param('id') id: string) {
    await this.expenses.remove(userId, id);
  }
}
