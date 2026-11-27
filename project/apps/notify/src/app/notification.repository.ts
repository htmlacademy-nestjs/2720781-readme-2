import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, mongo } from 'mongoose';
import type { UpdateQuery } from 'mongoose';
import type { EmailNotificationDto } from './notification.dto';
import { NotificationModel } from './mailing.model';
import { createHash } from 'node:crypto';
import type { MailingRun, MailingUser } from './mailing.model';

@Injectable()
export class NotificationRepository {
  constructor(
    @InjectModel(NotificationModel.name)
    private readonly notifications: Model<NotificationModel>,
  ) {}

  enqueue(task: EmailNotificationDto) {
    const { notificationId, scheduledAt, ...content } = task;
    return this.insert(notificationId, {
      ...content,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : new Date(),
    });
  }

  enqueueMailing(run: MailingRun, user: MailingUser) {
    if (!run.subject || !run.text)
      throw new Error('Рассылка ещё не подготовлена');
    const id = createHash('sha256')
      .update(`${run._id}:${user.userId}`)
      .digest('hex');
    return this.insert(id, {
      digestId: run._id,
      recipientEmail: user.email,
      subject: run.subject,
      text: run.text,
      html: run.html,
      scheduledAt: run.cutoffAt,
    });
  }

  private async insert(id: string, content: Partial<NotificationModel>) {
    try {
      await this.notifications
        .updateOne(
          { _id: id },
          {
            $setOnInsert: {
              ...content,
              status: 'pending',
              attempts: 0,
            },
          },
          { upsert: true },
        )
        .exec();
    } catch (error) {
      if (!(error instanceof mongo.MongoServerError && error.code === 11000))
        throw error;
    }
  }

  async findDueIds(
    now: Date,
    limit: number,
    mailingId?: string,
    after?: string,
  ) {
    const tasks = await this.notifications
      .find({
        ...this.dueFilter(now),
        digestId: mailingId ?? { $exists: false },
        ...(after ? { _id: { $gt: after } } : {}),
      })
      .select({ _id: 1 })
      .sort({ _id: 1 })
      .limit(limit)
      .lean()
      .exec();
    return tasks.map((task) => task._id);
  }

  countMailing(mailingId: string, sent: boolean) {
    return this.notifications
      .countDocuments({
        digestId: mailingId,
        status: sent ? 'sent' : { $ne: 'sent' },
      })
      .exec();
  }

  claim(id: string, now: Date, leaseMs: number, leaseToken: string) {
    return this.notifications
      .findOneAndUpdate(
        { _id: id, ...this.dueFilter(now) },
        {
          $set: {
            status: 'sending',
            leaseToken,
            lockedUntil: new Date(now.getTime() + leaseMs),
          },
          $inc: { attempts: 1 },
        },
        { returnDocument: 'after' },
      )
      .lean()
      .exec();
  }

  markSent(id: string, leaseToken: string) {
    return this.updateClaimed(id, leaseToken, {
      $set: { status: 'sent', sentAt: new Date() },
      $unset: { leaseToken: 1, lockedUntil: 1, lastError: 1 },
    });
  }

  release(id: string, leaseToken: string, lastError: string) {
    return this.updateClaimed(id, leaseToken, {
      $set: { status: 'pending', lastError },
      $unset: { leaseToken: 1, lockedUntil: 1 },
    });
  }

  private async updateClaimed(
    id: string,
    leaseToken: string,
    update: UpdateQuery<NotificationModel>,
  ) {
    const { matchedCount } = await this.notifications
      .updateOne({ _id: id, status: 'sending', leaseToken }, update)
      .exec();
    if (matchedCount !== 1) throw new Error('Утрачена блокировка задания');
  }

  private dueFilter(now: Date) {
    return {
      scheduledAt: { $lte: now },
      $or: [
        { status: 'pending' as const },
        { status: 'sending' as const, lockedUntil: { $lte: now } },
      ],
    };
  }
}
