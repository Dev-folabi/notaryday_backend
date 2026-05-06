import { IsEnum } from 'class-validator';
import { JobStatus } from '../../../../generated/prisma';

export class UpdateJobStatusDto {
  @IsEnum(JobStatus)
  status: JobStatus;
}
