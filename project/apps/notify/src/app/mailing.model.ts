import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

export const mailingStatuses = [
  'collecting',
  'preparing',
  'sending',
  'retry',
  'completed',
] as const;
export type MailingStatus = (typeof mailingStatuses)[number];

@Schema({ collection: 'digest_runs', timestamps: true })
export class MailingRun {
  @Prop({ type: String, required: true }) _id!: string;
  @Prop({ type: Date, required: true }) cutoffAt!: Date;
  @Prop({ type: Date }) periodStart?: Date;
  @Prop({ type: Number, required: true }) pageSize!: number;
  @Prop({ type: String, enum: mailingStatuses, default: 'collecting' })
  status!: MailingStatus;
  @Prop({ type: String, default: '' }) usersAfter!: string;
  @Prop({ type: String, default: '' }) postsAfter!: string;
  @Prop({ type: Boolean, default: false }) usersDone!: boolean;
  @Prop({ type: Boolean, default: false }) postsDone!: boolean;
  @Prop({ type: [String], default: [] }) postIds!: string[];
  @Prop({ type: String }) subject?: string;
  @Prop({ type: String }) text?: string;
  @Prop({ type: String }) html?: string;
  @Prop({ type: Date }) completedAt?: Date;
}

@Schema({ collection: 'digest_state' })
export class MailingState {
  @Prop({ type: String, required: true }) _id!: string;
  @Prop({ type: String }) activeRunId?: string;
  @Prop({ type: Date }) processedUntil?: Date;
  @Prop({ type: String }) leaseToken?: string;
  @Prop({ type: Date }) lockedUntil?: Date;
}

@Schema({ collection: 'digest_recipients' })
export class MailingUser {
  @Prop({ type: String, required: true }) _id!: string;
  @Prop({ type: String, required: true, index: true }) runId!: string;
  @Prop({ type: String, required: true }) userId!: string;
  @Prop({ type: String, required: true }) email!: string;
}

@Schema({ collection: 'digest_publications' })
export class MailingPost {
  @Prop({ type: String, required: true }) _id!: string;
  @Prop({ type: String, required: true, index: true }) runId!: string;
  @Prop({ type: String, required: true }) postId!: string;
  @Prop({ type: String, required: true }) title!: string;
  @Prop({ type: Date, required: true }) publishedAt!: Date;
}

@Schema({ collection: 'announced_publications' })
export class AnnouncedPost {
  @Prop({ type: String, required: true }) _id!: string;
  @Prop({ type: String, required: true }) runId!: string;
}

export const MailingRunSchema = SchemaFactory.createForClass(MailingRun);
export const MailingStateSchema = SchemaFactory.createForClass(MailingState);
export const MailingUserSchema = SchemaFactory.createForClass(MailingUser);
MailingUserSchema.index({ runId: 1, userId: 1 });
export const MailingPostSchema = SchemaFactory.createForClass(MailingPost);
export const AnnouncedPostSchema = SchemaFactory.createForClass(AnnouncedPost);

@Schema({ collection: 'email_notifications', timestamps: true })
export class NotificationModel {
  @Prop({ type: String, required: true })
  _id!: string;

  @Prop({ type: String, index: true })
  digestId?: string;

  @Prop({ type: String, required: true })
  recipientEmail!: string;

  @Prop({ type: String, required: true })
  subject!: string;

  @Prop({ type: String, required: true })
  text!: string;

  @Prop({ type: String })
  html?: string;

  @Prop({ type: Date, required: true })
  scheduledAt!: Date;

  @Prop({
    type: String,
    enum: ['pending', 'sending', 'sent'],
    default: 'pending',
  })
  status!: 'pending' | 'sending' | 'sent';

  @Prop({ type: Number, default: 0 })
  attempts!: number;

  @Prop({ type: String })
  leaseToken?: string;

  @Prop({ type: Date })
  lockedUntil?: Date;

  @Prop({ type: Date })
  sentAt?: Date;

  @Prop({ type: String })
  lastError?: string;
}

export const NotificationSchema =
  SchemaFactory.createForClass(NotificationModel);
NotificationSchema.index({ status: 1, scheduledAt: 1, lockedUntil: 1 });
NotificationSchema.index({ digestId: 1, status: 1, _id: 1 });
