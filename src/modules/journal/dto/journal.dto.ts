import {
  IsString,
  IsNumber,
  IsOptional,
  IsDateString,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateJournalEntryDto {
  @ApiProperty({
    example: '2025-06-01',
    description: 'Date of the notarial act',
  })
  @IsDateString()
  entry_date: string;

  @ApiProperty({
    example: 'acknowledgment',
    description: 'Type of notarial act performed',
  })
  @IsString()
  act_type: string;

  @ApiProperty({ example: 'John Doe' })
  @IsString()
  signer_name: string;

  @ApiPropertyOptional({ example: 'Drivers License' })
  @IsString()
  @IsOptional()
  signer_id_type?: string;

  @ApiPropertyOptional({ example: 'DL-123456789' })
  @IsString()
  @IsOptional()
  signer_id_number?: string;

  @ApiPropertyOptional({ example: 'Deed of Trust' })
  @IsString()
  @IsOptional()
  document_type?: string;

  @ApiPropertyOptional({ example: '123 Main St, Austin, TX 78701' })
  @IsString()
  @IsOptional()
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
  job_id?: string;

  @ApiPropertyOptional({ example: 'Signer appeared in person with valid ID' })
  @IsString()
  @IsOptional()
  @MaxLength(1000)
  notes?: string;
}
