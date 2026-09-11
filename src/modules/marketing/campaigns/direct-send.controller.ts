import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../../../common/guards/auth.guard';
import { AdminGuard } from '../../../common/guards/admin.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { DirectSendService } from './direct-send.service';
import { DirectSendDto } from '../dto/campaign.dto';

@ApiTags('Marketing Campaigns')
@ApiBearerAuth()
@Controller('marketing/send')
@UseGuards(AuthGuard, AdminGuard)
export class DirectSendController {
  constructor(private readonly direct: DirectSendService) {}

  @Post('direct')
  @ApiOperation({
    summary:
      'Send a one-off email to a lead, a platform user, or a raw address (goes through the tracked pipeline)',
  })
  async send(@CurrentUser('id') userId: string, @Body() dto: DirectSendDto) {
    return { success: true, data: await this.direct.send(dto, userId) };
  }
}
