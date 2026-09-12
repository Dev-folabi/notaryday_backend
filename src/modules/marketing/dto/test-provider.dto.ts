import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TestProviderDto {
  @ApiProperty({ example: 'admin@notaryday.app' })
  @IsEmail()
  to: string;

  @ApiPropertyOptional({ default: 'NotaryDay test email' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  subject?: string;

  @ApiPropertyOptional({ default: 'This is a test email from NotaryDay.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  text?: string;
}
