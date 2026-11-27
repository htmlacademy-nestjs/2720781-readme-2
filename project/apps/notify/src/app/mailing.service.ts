import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  NotificationEvent,
  PostsSnapshotPage,
  RabbitPublisher,
  UsersSnapshotPage,
} from '@project/shared-core';
import type { MailingRun } from './mailing.model';
import { MailingRepository } from './mailing.repository';
import { NotificationRepository } from './notification.repository';
import { NotificationMailer } from './notification.mailer';
import { randomUUID } from 'node:crypto';

@Injectable()
export class MailingService {
  private readonly logger = new Logger(MailingService.name);

  constructor(
    private readonly mailings: MailingRepository,
    private readonly notifications: NotificationRepository,
    private readonly mailer: NotificationMailer,
    private readonly publisher: RabbitPublisher,
    private readonly config: ConfigService,
  ) {}

  private get leaseMs() {
    return this.config.getOrThrow<number>('NOTIFY_LEASE_MS');
  }

  async trigger() {
    let token: string | null = null;
    try {
      await this.publisher.publish(
        this.config.getOrThrow<string>('RABBITMQ_QUEUE'),
        NotificationEvent.SendQueued,
        {},
      );
      token = await this.mailings.acquire(this.leaseMs);
      if (!token) {
        const run = await this.mailings.active();
        if (!run || run.status === 'completed')
          throw new ServiceUnavailableException(
            'Рассылка запускается; повторите запрос',
          );
        return await this.info(run);
      }
      let run = await this.mailings.active();
      if (!run || run.status === 'completed')
        run = await this.mailings.start(
          token,
          this.config.getOrThrow<number>('MAILING_PAGE_SIZE'),
        );
      if (run.status === 'collecting' && !(run.usersDone && run.postsDone)) {
        if (!run.usersDone) await this.requestSource(run, 'users');
        if (!run.postsDone) await this.requestSource(run, 'posts');
      } else await this.publishContinue(run._id);
      return await this.info(run);
    } catch {
      throw new ServiceUnavailableException(
        'Не удалось запустить рассылку; повторный запрос продолжит её',
      );
    } finally {
      if (token) await this.mailings.release(token);
    }
  }

  async acceptUsers(page: UsersSnapshotPage) {
    await this.mailings.acceptUsers(page);
    await this.advance(page.runId, 'users');
  }

  async acceptPosts(page: PostsSnapshotPage) {
    await this.mailings.acceptPosts(page);
    await this.advance(page.runId, 'posts');
  }

  private async advance(runId: string, source: 'users' | 'posts') {
    const run = await this.mailings.get(runId);
    if (!run || run.status !== 'collecting') return;
    if (run.usersDone && run.postsDone) await this.publishContinue(runId);
    else if (source === 'users' ? !run.usersDone : !run.postsDone)
      await this.requestSource(run, source);
  }

  private requestSource(run: MailingRun, source: 'users' | 'posts') {
    const users = source === 'users';
    return this.publisher.publish(
      this.config.getOrThrow<string>(
        users ? 'RABBITMQ_USER_QUEUE' : 'RABBITMQ_BLOG_QUEUE',
      ),
      users ? NotificationEvent.UsersRequest : NotificationEvent.PostsRequest,
      {
        runId: run._id,
        limit: run.pageSize,
        after: (users ? run.usersAfter : run.postsAfter) || undefined,
        ...(!users
          ? {
              from: (run.periodStart ?? new Date(0)).toISOString(),
              to: run.cutoffAt.toISOString(),
            }
          : {}),
      },
    );
  }

  private publishContinue(runId: string) {
    return this.publisher.publish(
      this.config.getOrThrow<string>('RABBITMQ_QUEUE'),
      NotificationEvent.Continue,
      { runId },
    );
  }

  async proceed(runId: string) {
    const active = await this.mailings.active();
    if (!active || active._id !== runId || active.status === 'completed')
      return;
    const token = await this.mailings.acquire(this.leaseMs);
    if (!token) {
      if (active.status === 'preparing' || active.status === 'sending') return;
      throw new Error('Рассылка занята другим обработчиком');
    }
    const renew = () => this.mailings.renew(token, this.leaseMs);
    try {
      let run = await this.mailings.get(runId);
      if (
        !run ||
        run.status === 'completed' ||
        !run.usersDone ||
        !run.postsDone
      )
        return;
      if (run.status === 'collecting') {
        const posts = await this.mailings.freshPosts(run);
        await renew();
        const fields = {
          ...formatMailing(
            posts,
            this.config.getOrThrow<string>('BLOG_PUBLIC_URL'),
          ),
          subject: this.config.getOrThrow<string>('MAILING_SUBJECT'),
          postIds: posts.map((post) => post.postId),
          status: 'preparing' as const,
        };
        await this.mailings.update(runId, fields);
        run = { ...run, ...fields };
      }
      if (run.status === 'preparing' && run.postIds.length) {
        let after: string | undefined;
        while (true) {
          await renew();
          const users = await this.mailings.recipients(
            runId,
            run.pageSize,
            after,
          );
          if (!users.length) break;
          for (const user of users) {
            await this.notifications.enqueueMailing(run, user);
            after = user.userId;
          }
        }
      }
      await renew();
      await this.mailings.update(runId, { status: 'sending' });
      const sent = await this.sendQueued(runId, renew);
      await renew();
      const remaining = await this.notifications.countMailing(runId, false);
      if (remaining) await this.mailings.update(runId, { status: 'retry' });
      else await this.mailings.complete(run, token, this.leaseMs);
      this.logger.log(
        `Рассылка ${runId}: отправлено ${sent}, осталось ${remaining}`,
      );
    } finally {
      await this.mailings.release(token);
    }
  }

  private async info(run: MailingRun) {
    const [recipientCount, publicationCount, sentCount, pendingCount] =
      await Promise.all([
        this.mailings.countUsers(run._id),
        run.status === 'collecting'
          ? this.mailings.countPosts(run._id)
          : run.postIds.length,
        this.notifications.countMailing(run._id, true),
        this.notifications.countMailing(run._id, false),
      ]);
    return {
      runId: run._id,
      status: run.status,
      recipientCount,
      publicationCount,
      sentCount,
      pendingCount,
    };
  }

  async sendQueued(mailingId?: string, renew?: () => Promise<void>) {
    const cutoff = new Date();
    let sent = 0;
    let after: string | undefined;
    while (true) {
      const ids = await this.notifications.findDueIds(
        cutoff,
        this.config.getOrThrow<number>('NOTIFY_BATCH_SIZE'),
        mailingId,
        after,
      );
      if (!ids.length) return sent;
      for (const id of ids) {
        after = id;
        await renew?.();
        const leaseToken = randomUUID();
        const task = await this.notifications.claim(
          id,
          new Date(),
          this.leaseMs,
          leaseToken,
        );
        if (!task) continue;
        try {
          await this.mailer.send(task);
        } catch {
          await this.notifications.release(
            id,
            leaseToken,
            'SMTP_DELIVERY_FAILED',
          );
          this.logger.warn(`Не удалось отправить уведомление ${id}`);
          continue;
        }
        await this.notifications.markSent(id, leaseToken);
        sent++;
      }
    }
  }
}

export function formatMailing(
  posts: { postId: string; title: string; publishedAt: Date }[],
  publicUrl: string,
) {
  const base = publicUrl.replace(/\/$/, '');
  const escape = (value: string) =>
    value.replace(
      /[&<>"']/g,
      (character) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[character] ?? character,
    );
  const items = posts.map((post) => ({
    title: post.title,
    url: `${base}/${encodeURIComponent(post.postId)}`,
    date: post.publishedAt.toISOString().slice(0, 10),
  }));
  return {
    text:
      'Новые публикации Readme\n\n' +
      items
        .map(
          (post, index) =>
            `${index + 1}. ${post.title} (${post.date})\n${post.url}`,
        )
        .join('\n\n'),
    html:
      '<h1>Новые публикации Readme</h1><ol>' +
      items
        .map(
          (post) =>
            `<li><a href="${escape(post.url)}">${escape(post.title)}</a> <small>${post.date}</small></li>`,
        )
        .join('') +
      '</ol>',
  };
}
