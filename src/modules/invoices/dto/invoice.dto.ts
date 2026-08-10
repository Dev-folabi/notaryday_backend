import { IsString, IsOptional, IsNumber, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class MarkPaidDto {
  @ApiPropertyOptional({ example: 'Zelle', description: 'Payment method used' })
  @IsString()
  @IsOptional()
  payment_method_used?: string;
}

export class SendInvoiceDto {
  @ApiPropertyOptional({
    example: 'client@example.com',
    description: 'Override recipient email (defaults to client email on job)',
  })
  @IsString()
  @IsOptional()
  recipient_email?: string;
}

export class UpdateInvoiceDto {
  @ApiPropertyOptional({
    example: 'Marcus Johnson',
    description: 'Billable client name shown on the invoice',
  })
  @IsString()
  @IsOptional()
  recipient_name?: string;

  @ApiPropertyOptional({
    example: 'client@example.com',
    description: 'Recipient email for the invoice',
  })
  @IsString()
  @IsOptional()
  recipient_email?: string;

  @ApiPropertyOptional({
    example: '150',
    description: 'Final fee amount — overrides the agreed job fee',
  })
  @IsNumber()
  @Min(0)
  @IsOptional()
  final_fee?: number;

  @ApiPropertyOptional({
    example: 'Thank you for your business',
    description: 'Note shown to the client on the invoice before sending',
  })
  @IsString()
  @IsOptional()
  note_to_client?: string;
}
