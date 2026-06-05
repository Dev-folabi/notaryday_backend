import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { JobStatus } from '../../../../generated/prisma';

export class UpdateJobStatusDto {
  @ApiProperty({
    enum: JobStatus,
    example: 'CONFIRMED',
    description: 'New job status',
  })
  @IsEnum(JobStatus)
  status: JobStatus;
}
