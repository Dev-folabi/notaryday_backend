import { IsString, IsOptional } from 'class-validator';
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
