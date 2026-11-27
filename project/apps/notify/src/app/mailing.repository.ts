import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { InvalidBrokerMessageError } from '@project/shared-core';
import type {
  PostsSnapshotPage,
  UsersSnapshotPage,
} from '@project/shared-core';
import { Model, mongo } from 'mongoose';
import { randomUUID } from 'node:crypto';
import {
  AnnouncedPost,
  MailingPost,
  MailingRun,
  MailingState,
  MailingUser,
} from './mailing.model';

@Injectable()
export class MailingRepository {
  constructor(
    @InjectModel(MailingRun.name) private readonly runs: Model<MailingRun>,
    @InjectModel(MailingState.name)
    private readonly states: Model<MailingState>,
    @InjectModel(MailingUser.name) private readonly users: Model<MailingUser>,
    @InjectModel(MailingPost.name) private readonly posts: Model<MailingPost>,
    @InjectModel(AnnouncedPost.name)
    private readonly announced: Model<AnnouncedPost>,
  ) {}

  async acquire(leaseMs: number) {
    await this.ignoreDuplicate(() =>
      this.states
        .updateOne(
          { _id: 'newsletter' },
          { $setOnInsert: { _id: 'newsletter' } },
          { upsert: true },
        )
        .exec(),
    );
    const now = new Date();
    const leaseToken = randomUUID();
    const state = await this.states
      .findOneAndUpdate(
        {
          _id: 'newsletter',
          $or: [
            { lockedUntil: { $exists: false } },
            { lockedUntil: { $lte: now } },
          ],
        },
        {
          $set: { leaseToken, lockedUntil: new Date(now.getTime() + leaseMs) },
        },
        { returnDocument: 'after' },
      )
      .lean()
      .exec();
    return state ? leaseToken : null;
  }

  async renew(token: string, leaseMs: number) {
    const result = await this.states
      .updateOne(
        { _id: 'newsletter', leaseToken: token },
        { $set: { lockedUntil: new Date(Date.now() + leaseMs) } },
      )
      .exec();
    if (result.matchedCount !== 1)
      throw new Error('Утрачена блокировка рассылки');
  }

  async release(token: string) {
    await this.states
      .updateOne(
        { _id: 'newsletter', leaseToken: token },
        { $unset: { leaseToken: 1, lockedUntil: 1 } },
      )
      .exec();
  }

  async active() {
    const state = await this.states.findById('newsletter').lean().exec();
    return state?.activeRunId ? this.get(state.activeRunId) : null;
  }

  get(id: string) {
    return this.runs.findById(id).lean().exec();
  }

  async start(token: string, pageSize: number) {
    const state = await this.states.findById('newsletter').lean().exec();
    const run = await this.runs.create({
      _id: randomUUID(),
      periodStart: state?.processedUntil ?? new Date(0),
      cutoffAt: new Date(),
      pageSize,
    });
    const result = await this.states
      .updateOne(
        { _id: 'newsletter', leaseToken: token },
        { $set: { activeRunId: run._id } },
      )
      .exec();
    if (result.matchedCount !== 1)
      throw new Error('Утрачена блокировка рассылки');
    return run.toObject();
  }

  acceptUsers(page: UsersSnapshotPage) {
    return this.acceptPage(page, 'users', (user) =>
      this.users
        .updateOne(
          { _id: `${page.runId}:${user.id}` },
          {
            $setOnInsert: {
              runId: page.runId,
              userId: user.id,
              email: user.email,
            },
          },
          { upsert: true },
        )
        .exec(),
    );
  }

  acceptPosts(page: PostsSnapshotPage) {
    return this.acceptPage(page, 'posts', (post) =>
      this.posts
        .updateOne(
          { _id: `${page.runId}:${post.id}` },
          {
            $setOnInsert: {
              runId: page.runId,
              postId: post.id,
              title: post.title,
              publishedAt: new Date(post.publishedAt),
            },
          },
          { upsert: true },
        )
        .exec(),
    );
  }

  async freshPosts(run: MailingRun) {
    const posts = await this.posts
      .find({
        runId: run._id,
        publishedAt: {
          $gte: run.periodStart ?? new Date(0),
          $lt: run.cutoffAt,
        },
      })
      .sort({ publishedAt: 1, postId: 1 })
      .lean()
      .exec();
    const known = await this.announced
      .find({ _id: { $in: posts.map((post) => post.postId) } })
      .select({ _id: 1 })
      .lean()
      .exec();
    const ids = new Set(known.map((post) => post._id));
    return posts.filter((post) => !ids.has(post.postId));
  }

  recipients(runId: string, limit: number, after?: string) {
    return this.users
      .find({ runId, ...(after ? { userId: { $gt: after } } : {}) })
      .sort({ userId: 1 })
      .limit(limit)
      .lean()
      .exec();
  }

  countUsers(runId: string) {
    return this.users.countDocuments({ runId }).exec();
  }

  countPosts(runId: string) {
    return this.posts.countDocuments({ runId }).exec();
  }

  async update(runId: string, fields: Partial<MailingRun>) {
    await this.runs.updateOne({ _id: runId }, { $set: fields }).exec();
  }

  async complete(run: MailingRun, token: string, leaseMs: number) {
    const hasRecipients = (await this.countUsers(run._id)) > 0;
    if (hasRecipients) {
      for (const [index, id] of run.postIds.entries()) {
        if (index % 100 === 0) await this.renew(token, leaseMs);
        await this.ignoreDuplicate(() =>
          this.announced
            .updateOne(
              { _id: id },
              { $setOnInsert: { runId: run._id } },
              { upsert: true },
            )
            .exec(),
        );
      }
    }
    await this.renew(token, leaseMs);
    if (hasRecipients) {
      const { matchedCount } = await this.states
        .updateOne(
          { _id: 'newsletter', leaseToken: token },
          { $max: { processedUntil: run.cutoffAt } },
        )
        .exec();
      if (matchedCount !== 1) throw new Error('Утрачена блокировка рассылки');
    }
    await this.update(run._id, {
      status: 'completed',
      completedAt: new Date(),
    });
  }

  private async acceptPage<T>(
    page: { runId: string; items: T[]; after?: string; nextAfter?: string },
    source: 'users' | 'posts',
    save: (item: T) => Promise<unknown>,
  ) {
    const run = await this.get(page.runId);
    const cursor = `${source}After` as const;
    const done = `${source}Done` as const;
    if (
      !run ||
      run.status !== 'collecting' ||
      run[done] ||
      run[cursor] !== (page.after ?? '')
    )
      return;
    if (
      page.items.length > run.pageSize ||
      Boolean(page.nextAfter) !== (page.items.length === run.pageSize)
    )
      throw new InvalidBrokerMessageError('Некорректный размер страницы');
    for (const item of page.items) await this.ignoreDuplicate(() => save(item));
    await this.runs
      .updateOne(
        {
          _id: run._id,
          status: 'collecting',
          [cursor]: run[cursor],
          [done]: false,
        },
        {
          $set: {
            [cursor]: page.nextAfter ?? run[cursor],
            [done]: !page.nextAfter,
          },
        },
      )
      .exec();
  }

  private async ignoreDuplicate(work: () => Promise<unknown>) {
    try {
      await work();
    } catch (error) {
      if (!(error instanceof mongo.MongoServerError && error.code === 11000))
        throw error;
    }
  }
}
