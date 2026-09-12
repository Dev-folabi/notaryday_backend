import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../../../common/guards/auth.guard';
import { AdminGuard } from '../../../common/guards/admin.guard';
import { PlaybooksService } from './playbooks.service';

@ApiTags('Marketing Playbooks')
@ApiBearerAuth()
@Controller('marketing/playbooks')
@UseGuards(AuthGuard, AdminGuard)
export class PlaybooksController {
  constructor(private readonly playbooks: PlaybooksService) {}

  @Get()
  @ApiOperation({
    summary: 'Outreach playbooks (seeded from the campaign spreadsheet)',
  })
  async list() {
    return { success: true, data: await this.playbooks.list() };
  }
}
