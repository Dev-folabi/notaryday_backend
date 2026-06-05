import {
  Controller,
  Post,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { AuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ScreenshotImportService } from './screenshot-import.service';

@ApiTags('Screenshot Import')
@ApiBearerAuth()
@Controller('screenshot-import')
@UseGuards(AuthGuard)
export class ScreenshotImportController {
  constructor(private readonly screenshots: ScreenshotImportService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Upload a screenshot to parse job details via OCR' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'Screenshot image file (PNG, JPG)',
        },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Parsed job data from screenshot' })
  @ApiResponse({ status: 400, description: 'Invalid file or unable to parse' })
  async upload(@CurrentUser('id') userId: string, @UploadedFile() file: any) {
    const result = await this.screenshots.handleUpload(userId, file);
    return { success: true, data: result };
  }
}
