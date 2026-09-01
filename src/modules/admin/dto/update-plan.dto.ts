import { IsEnum, IsOptional, IsDateString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PlanTier } from '../../../../generated/prisma';

export class UpdateUserPlanDto {
  @ApiProperty({ enum: PlanTier, example: 'PRO' })
  @IsEnum(PlanTier)
  plan: PlanTier;

  @ApiPropertyOptional({
    description:
      'ISO date when the plan lapses (required for PRO_ANNUAL; pass null/omit for FREE)',
    example: '2027-08-31T00:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  planExpiresAt?: string;
}
