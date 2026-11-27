import { Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Ctx, EventPattern, Payload, RmqContext } from '@nestjs/microservices';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  handleRabbitEvent,
  NotificationEvent,
  parseBrokerMessage,
  PostsSnapshotPage,
  RunMessage,
  UsersSnapshotPage,
  validateSnapshotPage,
} from '@project/shared-core';
import {
  ENQUEUE_EMAIL,
  EmailNotificationDto,
  MailingResponseDto,
} from './notification.dto';
import { NotificationRepository } from './notification.repository';
import { MailingService } from './mailing.service';
import { NotifyTriggerGuard } from './notify-trigger.guard';

@Controller('notifications')
@ApiTags('notifications')
export class MailingController {
  constructor(
    private readonly notifications: NotificationRepository,
    private readonly mailings: MailingService,
  ) {}

  @EventPattern(ENQUEUE_EMAIL)
  enqueue(@Payload() payload: unknown, @Ctx() context: RmqContext) {
    return handleRabbitEvent(context, () =>
      this.notifications.enqueue(
        parseBrokerMessage(EmailNotificationDto, payload),
      ),
    );
  }

  @EventPattern(NotificationEvent.SendQueued)
  sendQueued(@Ctx() context: RmqContext) {
    return handleRabbitEvent(context, () => this.mailings.sendQueued());
  }

  @EventPattern(NotificationEvent.UsersPage)
  users(@Payload() payload: unknown, @Ctx() context: RmqContext) {
    return handleRabbitEvent(context, async () => {
      const page = parseBrokerMessage(UsersSnapshotPage, payload);
      validateSnapshotPage(page);
      await this.mailings.acceptUsers(page);
    });
  }

  @EventPattern(NotificationEvent.PostsPage)
  posts(@Payload() payload: unknown, @Ctx() context: RmqContext) {
    return handleRabbitEvent(context, async () => {
      const page = parseBrokerMessage(PostsSnapshotPage, payload);
      validateSnapshotPage(page);
      await this.mailings.acceptPosts(page);
    });
  }

  @EventPattern(NotificationEvent.Continue)
  proceed(@Payload() payload: unknown, @Ctx() context: RmqContext) {
    return handleRabbitEvent(context, () => {
      const message = parseBrokerMessage(RunMessage, payload);
      return this.mailings.proceed(message.runId);
    });
  }

  @Post('send')
  @HttpCode(202)
  @UseGuards(NotifyTriggerGuard)
  @ApiBearerAuth('notify-trigger')
  @ApiOperation({
    summary: 'Запустить отправку писем и рассылку новых публикаций',
    description:
      'Готовые отдельные письма отправляются асинхронно независимо от ответов User и Blog. Снимки для общей рассылки запрашиваются через RabbitMQ. Незавершённый запуск продолжается с сохранённого состояния.',
  })
  @ApiAcceptedResponse({ type: MailingResponseDto })
  @ApiUnauthorizedResponse({
    description: 'Отсутствует или неверен access JWT либо служебный токен.',
  })
  @ApiServiceUnavailableResponse({
    description:
      'Не удалось опубликовать запросы; повторный вызов продолжит запуск.',
  })
  sendScheduled() {
    return this.mailings.trigger();
  }
}
