import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  Body,
  UseGuards,
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
import { InvoicesService } from './invoices.service';
import { MarkPaidDto, SendInvoiceDto } from './dto/invoice.dto';

@ApiTags('Invoices')
@ApiBearerAuth()
@Controller('invoices')
@UseGuards(AuthGuard)
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Post('generate/:jobId')
  @ApiOperation({ summary: 'Generate an invoice PDF for a completed job' })
  @ApiParam({ name: 'jobId', description: 'Job UUID to generate invoice for' })
  @ApiResponse({ status: 201, description: 'Invoice generated' })
  @ApiResponse({ status: 404, description: 'Job not found' })
  async generate(
    @CurrentUser('id') userId: string,
    @Param('jobId') jobId: string,
  ) {
    return { success: true, data: await this.invoices.generate(userId, jobId) };
  }

  @Get()
  @ApiOperation({ summary: 'List all invoices' })
  @ApiQuery({
    name: 'is_paid',
    required: false,
    example: 'true',
    description: 'Filter by payment status',
  })
  @ApiResponse({ status: 200, description: 'Array of invoices' })
  async findAll(
    @CurrentUser('id') userId: string,
    @Query('is_paid') isPaid?: string,
  ) {
    const filters =
      isPaid !== undefined ? { is_paid: isPaid === 'true' } : undefined;
    return {
      success: true,
      data: await this.invoices.findAll(userId, filters),
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single invoice by ID' })
  @ApiParam({ name: 'id', description: 'Invoice UUID' })
  @ApiResponse({ status: 200, description: 'Invoice object' })
  @ApiResponse({ status: 404, description: 'Invoice not found' })
  async findOne(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return { success: true, data: await this.invoices.findOne(userId, id) };
  }

  @Patch(':id/mark-paid')
  @ApiOperation({ summary: 'Mark an invoice as paid' })
  @ApiParam({ name: 'id', description: 'Invoice UUID' })
  @ApiResponse({ status: 200, description: 'Invoice marked as paid' })
  async markPaid(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: MarkPaidDto,
  ) {
    return {
      success: true,
      data: await this.invoices.markPaid(userId, id, dto.payment_method_used),
    };
  }

  @Post(':id/send')
  @ApiOperation({ summary: 'Send invoice via email to client' })
  @ApiParam({ name: 'id', description: 'Invoice UUID' })
  @ApiResponse({ status: 200, description: 'Invoice email sent' })
  async send(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: SendInvoiceDto,
  ) {
    return {
      success: true,
      data: await this.invoices.send(userId, id, dto.recipient_email),
    };
  }
}
