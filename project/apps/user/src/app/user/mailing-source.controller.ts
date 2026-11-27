import { Controller } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Ctx, EventPattern, Payload, RmqContext } from '@nestjs/microservices';
import {
  handleRabbitEvent,
  NotificationEvent,
  parseBrokerMessage,
  RabbitPublisher,
  UsersSnapshotRequest,
} from '@project/shared-core';
import { UserRepository } from './user.repository';

@Controller()
export class MailingSourceController {
  constructor(
    private readonly users: UserRepository,
    private readonly publisher: RabbitPublisher,
    private readonly config: ConfigService,
  ) {}

  @EventPattern(NotificationEvent.UsersRequest)
  snapshot(@Payload() payload: unknown, @Ctx() context: RmqContext) {
    return handleRabbitEvent(context, async () => {
      const request = parseBrokerMessage(UsersSnapshotRequest, payload);
      const items = await this.users.findMailingUsers(request);
      await this.publisher.publish(
        this.config.getOrThrow<string>('RABBITMQ_QUEUE'),
        NotificationEvent.UsersPage,
        {
          runId: request.runId,
          after: request.after,
          items,
          nextAfter:
            items.length === request.limit
              ? items[items.length - 1]?.id
              : undefined,
        },
      );
    });
  }
}
