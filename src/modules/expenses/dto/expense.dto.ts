import {
  IsString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsDateString,
  Min,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ExpenseCategory } from '../../../../generated/prisma';

export class CreateExpenseDto {
  @ApiProperty({ enum: ExpenseCategory, example: 'MILEAGE' })
  @IsEnum(ExpenseCategory)
  category: ExpenseCategory;

  @ApiProperty({ example: 45.5, description: 'Expense amount in dollars' })
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  amount: number;

  @ApiProperty({ example: 'Ink cartridges for printer' })
  @IsString()
  @MaxLength(500)
  description: string;

  @ApiProperty({
    example: '2025-06-01',
    description: 'Date of expense (ISO 8601)',
  })
  @IsDateString()
  expense_date: string;

  @ApiPropertyOptional({ example: 'https://s3.amazonaws.com/receipts/abc.jpg' })
  @IsString()
  @IsOptional()
  receipt_url?: string;

  @ApiPropertyOptional({ example: 'Office Depot purchase' })
  @IsString()
  @IsOptional()
  @MaxLength(1000)
  notes?: string;
}

export class UpdateExpenseDto {
  @ApiPropertyOptional({ enum: ExpenseCategory })
  @IsEnum(ExpenseCategory)
  @IsOptional()
  category?: ExpenseCategory;

  @ApiPropertyOptional({ example: 52.0 })
  @IsNumber()
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  amount?: number;

  @ApiPropertyOptional({ example: 'Updated description' })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ example: '2025-06-02' })
  @IsDateString()
  @IsOptional()
  expense_date?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  receipt_url?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  @MaxLength(1000)
  notes?: string;
}
