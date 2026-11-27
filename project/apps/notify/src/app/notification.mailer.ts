import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport } from 'nodemailer';
import type { NotificationModel } from './mailing.model';

@Injectable()
export class NotificationMailer implements OnApplicationShutdown {
  private readonly transport;
  private readonly from: string;

  constructor(config: ConfigService) {
    const timeout = config.getOrThrow<number>('SMTP_TIMEOUT_MS');
    this.from = config.getOrThrow<string>('SMTP_FROM');
    this.transport = createTransport({
      host: config.getOrThrow<string>('SMTP_HOST'),
      port: config.getOrThrow<number>('SMTP_PORT'),
      secure: config.getOrThrow<boolean>('SMTP_SECURE'),
      auth: config.get<string>('SMTP_USER')
        ? {
            user: config.getOrThrow<string>('SMTP_USER'),
            pass: config.getOrThrow<string>('SMTP_PASSWORD'),
          }
        : undefined,
      connectionTimeout: timeout,
      greetingTimeout: timeout,
      socketTimeout: timeout,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
  }

  async send(task: NotificationModel) {
    await this.transport.sendMail({
      from: this.from,
      to: { address: task.recipientEmail, name: '' },
      subject: task.subject,
      text: task.text,
      html: task.html,
      messageId: `<${task._id}@${this.from.split('@')[1]}>`,
    });
  }

  onApplicationShutdown() {
    this.transport.close();
  }
}
