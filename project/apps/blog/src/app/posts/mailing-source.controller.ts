import { Controller } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Ctx, EventPattern, Payload, RmqContext } from '@nestjs/microservices';
import {
  handleRabbitEvent,
  InvalidBrokerMessageError,
  NotificationEvent,
  parseBrokerMessage,
  PostsSnapshotRequest,
  RabbitPublisher,
} from '@project/shared-core';
import { PrismaService } from '../prisma/prisma.service';

@Controller()
export class MailingSourceController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly publisher: RabbitPublisher,
    private readonly config: ConfigService,
  ) {}

  @EventPattern(NotificationEvent.PostsRequest)
  snapshot(@Payload() payload: unknown, @Ctx() context: RmqContext) {
    return handleRabbitEvent(context, async () => {
      const request = parseBrokerMessage(PostsSnapshotRequest, payload);
      const from = new Date(request.from);
      const to = new Date(request.to);
      if (
        !Number.isFinite(from.getTime()) ||
        !Number.isFinite(to.getTime()) ||
        from > to
      )
        throw new InvalidBrokerMessageError('Некорректный период рассылки');
      const posts = await this.prisma.post.findMany({
        where: {
          status: 'published',
          deletedAt: null,
          publishedAt: { gte: from, lt: to },
          ...(request.after ? { id: { gt: request.after } } : {}),
        },
        select: {
          id: true,
          title: true,
          type: true,
          quote: true,
          quoteAuthor: true,
          description: true,
          url: true,
          publishedAt: true,
        },
        orderBy: { id: 'asc' },
        take: request.limit,
      });
      const items = posts.map((post) => ({
        id: post.id,
        title: (
          post.title ??
          (post.type === 'quote'
            ? `${post.quote} — ${post.quoteAuthor}`
            : post.type === 'photo'
              ? 'Фотография'
              : post.description || post.url || 'Публикация')
        ).slice(0, 1000),
        publishedAt: post.publishedAt.toISOString(),
      }));
      await this.publisher.publish(
        this.config.getOrThrow<string>('RABBITMQ_QUEUE'),
        NotificationEvent.PostsPage,
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
