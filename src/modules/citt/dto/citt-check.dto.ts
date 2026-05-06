import {
  IsString,
  IsNumber,
  IsDateString,
  IsPositive,
  IsOptional,
  IsEnum,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SigningType } from '../../../../generated/prisma';

export class CittCheckDto {
  /** Full street address of the proposed job */
  @IsString()
  address: string;

  /** ISO8601 appointment start time */
  @IsDateString()
  appointment_time: string;

  /** Offered fee in dollars */
  @IsNumber()
  @IsPositive()
  @Type(() => Number)
  fee: number;

  @IsEnum(SigningType)
  @IsOptional()
  signing_type?: SigningType = SigningType.GENERAL;

  /** Platform deduction (e.g. Snapdocs fee) */
  @IsNumber()
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  platform_fee?: number = 0;

  /** Override signing duration (minutes). Defaults to user's setting. */
  @IsNumber()
  @IsPositive()
  @IsOptional()
  @Type(() => Number)
  signing_duration_mins?: number;
}
