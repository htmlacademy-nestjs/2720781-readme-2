import { Injectable, Logger, Module } from '@nestjs/common';
import type { OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Transport } from '@nestjs/microservices';
import type { RmqContext, RmqOptions } from '@nestjs/microservices';
import { connect } from 'amqp-connection-manager';
import type { Channel, ConsumeMessage } from 'amqplib';
import { InvalidBrokerMessageError } from './notification-messages';

export type NotificationQueueKey =
  | 'RABBITMQ_QUEUE'
  | 'RABBITMQ_USER_QUEUE'
  | 'RABBITMQ_BLOG_QUEUE';

export function rabbitQueueOptions(queue: string) {
  return {
    durable: true,
    deadLetterExchange: '',
    deadLetterRoutingKey: `${queue}.dead`,
  };
}

export function rabbitServerOptions(
  config: ConfigService,
  key: NotificationQueueKey,
): RmqOptions {
  const queue = config.getOrThrow<string>(key);
  const prefetchCount = Number(config.getOrThrow('RABBITMQ_PREFETCH'));
  if (
    !Number.isInteger(prefetchCount) ||
    prefetchCount < 1 ||
    prefetchCount > 100
  )
    throw new Error('RABBITMQ_PREFETCH должен быть целым числом от 1 до 100');
  return {
    transport: Transport.RMQ,
    options: {
      urls: [config.getOrThrow<string>('RABBITMQ_URL')],
      queue,
      noAck: false,
      prefetchCount,
      queueOptions: rabbitQueueOptions(queue),
    },
  };
}

@Injectable()
export class RabbitPublisher implements OnApplicationShutdown {
  private readonly connection;
  private readonly channel;
  private readonly timeout: number;

  constructor(config: ConfigService) {
    this.timeout = Number(config.getOrThrow('RABBITMQ_TIMEOUT_MS'));
    if (
      !Number.isInteger(this.timeout) ||
      this.timeout < 1000 ||
      this.timeout > 60000
    )
      throw new Error('RABBITMQ_TIMEOUT_MS должен быть от 1000 до 60000');
    const queues = (
      ['RABBITMQ_QUEUE', 'RABBITMQ_USER_QUEUE', 'RABBITMQ_BLOG_QUEUE'] as const
    ).map((key) => config.getOrThrow<string>(key));
    if (new Set(queues).size !== queues.length)
      throw new Error('Очереди Notify, User и Blog должны различаться');
    this.connection = connect([config.getOrThrow<string>('RABBITMQ_URL')]);
    this.connection.on('disconnect', () =>
      Logger.warn('RabbitMQ: соединение прервано'),
    );
    this.channel = this.connection.createChannel({
      publishTimeout: this.timeout,
      setup: async (channel: Channel) => {
        for (const queue of queues) {
          await channel.assertQueue(`${queue}.dead`, { durable: true });
          await channel.assertQueue(queue, rabbitQueueOptions(queue));
        }
      },
    });
    this.channel.on('error', () =>
      Logger.error('RabbitMQ: ошибка объявления очередей'),
    );
  }

  async ready() {
    await this.connection.connect({ timeout: this.timeout });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.channel.waitForConnect(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () =>
              reject(new Error('RabbitMQ: истёк таймаут подготовки очередей')),
            this.timeout,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async publish(queue: string, pattern: string, data: unknown) {
    await this.channel.sendToQueue(
      queue,
      Buffer.from(JSON.stringify({ pattern, data })),
      {
        persistent: true,
        contentType: 'application/json',
        timeout: this.timeout,
      },
    );
  }

  async onApplicationShutdown() {
    await this.channel.close();
    await this.connection.close();
  }
}

@Module({ providers: [RabbitPublisher], exports: [RabbitPublisher] })
export class RabbitModule {}

export async function handleRabbitEvent(
  context: RmqContext,
  work: () => Promise<unknown>,
) {
  const channel = context.getChannelRef() as Channel;
  const message = context.getMessage() as ConsumeMessage;
  try {
    await work();
    channel.ack(message);
  } catch (error) {
    const invalid = error instanceof InvalidBrokerMessageError;
    Logger.warn(
      invalid
        ? 'Сообщение направлено в dead-letter очередь'
        : 'Сообщение возвращено в RabbitMQ',
    );
    channel.nack(message, false, !invalid);
  }
}
