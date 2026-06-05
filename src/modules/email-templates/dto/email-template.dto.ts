import { IsString, IsBoolean, IsOptional, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateEmailTemplateDto {
  @ApiProperty({ example: 'Invoice Reminder' })
  @IsString()
  name: string;

  @ApiProperty({
    example: 'invoice_reminder',
    description: 'Template type identifier',
  })
  @IsString()
  type: string;

  @ApiProperty({ example: 'Invoice #{invoice_number} from {notary_name}' })
  @IsString()
  @MaxLength(200)
  subject: string;

  @ApiProperty({
    example:
      '<h1>Invoice</h1><p>Hi {client_name}, please find your invoice attached.</p>',
  })
  @IsString()
  @MaxLength(10000)
  body: string;
}

export class UpdateEmailTemplateDto {
  @ApiPropertyOptional({ example: 'Updated Invoice Reminder' })
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional({ example: 'Updated subject line' })
  @IsString()
  @IsOptional()
  @MaxLength(200)
  subject?: string;

  @ApiPropertyOptional({ example: '<h1>Updated body</h1>' })
  @IsString()
  @IsOptional()
  @MaxLength(10000)
  body?: string;

  @ApiPropertyOptional({
    example: true,
    description: 'Enable or disable this template',
  })
  @IsBoolean()
  @IsOptional()
  is_active?: boolean;
}
