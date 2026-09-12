import { IsEnum, IsString, IsEmail, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { TransactionalProviderType } from '../../transactional-email/interface';

export class SetActiveEmailProviderDto {
  @ApiProperty({ enum: ['resend', 'brevo'], example: 'resend' })
  @IsEnum(['resend', 'brevo'] as const)
  provider: TransactionalProviderType;
}

export class TestEmailDto {
  @ApiProperty({ enum: ['resend', 'brevo'], example: 'resend' })
  @IsEnum(['resend', 'brevo'] as const)
  provider: TransactionalProviderType;

  @ApiProperty({ example: 'test@example.com' })
  @IsEmail()
  to: string;

  @ApiProperty({ example: 'Test email subject' })
  @IsString()
  subject: string;

  @ApiProperty({ example: '<p>Hello from Notary Day</p>' })
  @IsString()
  html: string;

  @ApiPropertyOptional({ example: 'Hello from Notary Day' })
  @IsOptional()
  @IsString()
  text?: string;
}
