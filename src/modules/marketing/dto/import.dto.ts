import {
  IsArray,
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SaveMappingDto {
  @ApiProperty({
    description:
      'Mapping of canonical target field -> 0-based column index. Only known target fields are accepted.',
    example: { leadId: 0, email: 6 },
  })
  @IsObject()
  mapping: Record<string, number>;

  @ApiPropertyOptional({
    description: 'Save this mapping as a reusable preset',
    example: 'notaryday_leads_v4',
  })
  @IsOptional()
  @ValidateIf((dto: SaveMappingDto) => dto.saveAsPreset !== undefined)
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  saveAsPreset?: string;
}

export class StartImportDto {
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  skipNoEmail?: boolean;
}

export class CreateMappingPresetDto {
  @ApiProperty({ example: 'notaryday_leads_v4' })
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name: string;

  @ApiProperty({ type: Object })
  @IsObject()
  mapping: Record<string, number>;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  headers?: string[];
}
