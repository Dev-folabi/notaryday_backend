import {
  IsString,
  IsEnum,
  IsOptional,
  IsDateString,
  IsEmail,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SigningType } from '../../../../generated/prisma';

export class CreateBookingDto {
  @ApiProperty({ example: 'John Doe' })
  @IsString()
  client_name: string;

  @ApiProperty({ example: 'client@example.com' })
  @IsEmail()
  client_email: string;

  @ApiPropertyOptional({ example: '+15125551234' })
  @IsString()
  @IsOptional()
  client_phone?: string;

  @ApiProperty({ example: '789 Elm St, Austin, TX 78703' })
  @IsString()
  address: string;

  @ApiProperty({ enum: SigningType, example: 'LOAN_REFI' })
  @IsEnum(SigningType)
  service_type: SigningType;

  @ApiProperty({
    example: '2025-06-02T10:00:00.000Z',
    description: 'Requested appointment time',
  })
  @IsDateString()
  requested_time: string;

  @ApiPropertyOptional({ example: 'Deed of Trust' })
  @IsString()
  @IsOptional()
  document_type?: string;

  @ApiPropertyOptional({ example: 'Please arrive 10 min early' })
  @IsString()
  @IsOptional()
  @MaxLength(1000)
  notes?: string;
}

export class DeclineBookingDto {
  @ApiPropertyOptional({ example: 'Schedule conflict' })
  @IsString()
  @IsOptional()
  reason?: string;

  @ApiPropertyOptional({
    example: ['2025-06-02T14:00:00.000Z', '2025-06-03T10:00:00.000Z'],
    description: 'Suggested alternative times',
  })
  @IsDateString({ strict: false }, { each: true })
  @IsOptional()
  alternative_times?: string[];
}

export class GetSlotsQueryDto {
  @ApiProperty({
    example: '2025-06-02',
    description: 'Date to check availability',
  })
  @IsString()
  date: string;

  @ApiPropertyOptional({ enum: SigningType })
  @IsEnum(SigningType)
  @IsOptional()
  service_type?: SigningType;
}

export class GetAlternativesQueryDto {
  @ApiProperty({
    example: '2025-06-02',
    description: 'Calendar date of the requested slot',
  })
  @IsString()
  date: string;

  @ApiProperty({
    example: '14:00',
    description: 'Wall-clock time (HH:MM) of the requested slot to exclude',
  })
  @IsString()
  time: string;

  @ApiPropertyOptional({ enum: SigningType })
  @IsEnum(SigningType)
  @IsOptional()
  service_type?: SigningType;
}
