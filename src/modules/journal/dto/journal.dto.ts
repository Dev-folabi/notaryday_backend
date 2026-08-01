import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsDateString,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PartialType } from '@nestjs/mapped-types';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateJournalEntryDto {
  @ApiProperty({
    example: '2025-06-01',
    description: 'Date of the notarial act',
  })
  @IsDateString()
  @IsNotEmpty()
  entry_date: string;

  @ApiProperty({
    example: 'acknowledgment',
    description: 'Type of notarial act performed',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  act_type: string;

  @ApiProperty({ example: 'John Doe' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  signer_name: string;

  @ApiPropertyOptional({
    example: 'LOAN_REFI',
    description: 'Signing type the entry belongs to',
  })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  signing_type?: string;

  @ApiPropertyOptional({
    example: '14:00',
    description: 'Time of the notarial act (HH:mm)',
  })
  @IsString()
  @IsOptional()
  @MaxLength(10)
  act_time?: string;

  @ApiPropertyOptional({ example: 'Drivers License' })
  @IsString()
  @IsOptional()
  @MaxLength(200)
  signer_id_type?: string;

  @ApiPropertyOptional({ example: 'DL-123456789' })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  signer_id_number?: string;

  @ApiPropertyOptional({ example: 'Deed of Trust' })
  @IsString()
  @IsOptional()
  @MaxLength(300)
  document_type?: string;

  @ApiPropertyOptional({ example: '123 Main St, Austin, TX 78701' })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  address?: string;

  @ApiPropertyOptional({
    example: 10,
    description: 'Fee charged for the notarial act',
  })
  @IsNumber()
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  fee_charged?: number;

  @ApiPropertyOptional({ description: 'Associated job UUID' })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  job_id?: string;

  @ApiPropertyOptional({ example: 'Signer appeared in person with valid ID' })
  @IsString()
  @IsOptional()
  @MaxLength(1000)
  notes?: string;
}

export class UpdateJournalEntryDto extends PartialType(CreateJournalEntryDto) {}
