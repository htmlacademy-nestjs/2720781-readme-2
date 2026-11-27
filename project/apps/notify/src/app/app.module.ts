import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule, RabbitModule } from '@project/shared-core';
import {
  AnnouncedPost,
  AnnouncedPostSchema,
  MailingPost,
  MailingPostSchema,
  MailingRun,
  MailingRunSchema,
  MailingState,
  MailingStateSchema,
  MailingUser,
  MailingUserSchema,
  NotificationModel,
  NotificationSchema,
} from './mailing.model';
import { MailingRepository } from './mailing.repository';
import { MailingService } from './mailing.service';
import { MailingController } from './mailing.controller';
import { NotificationMailer } from './notification.mailer';
import { NotificationRepository } from './notification.repository';
import { validateEnvironment } from './notify.config';
import { NotifyTriggerGuard } from './notify-trigger.guard';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: 'apps/notify/.env',
      validate: validateEnvironment,
    }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.getOrThrow<string>('MONGO_URI'),
        serverSelectionTimeoutMS: 5000,
      }),
    }),
    MongooseModule.forFeature([
      { name: NotificationModel.name, schema: NotificationSchema },
      { name: MailingRun.name, schema: MailingRunSchema },
      { name: MailingState.name, schema: MailingStateSchema },
      { name: MailingUser.name, schema: MailingUserSchema },
      { name: MailingPost.name, schema: MailingPostSchema },
      { name: AnnouncedPost.name, schema: AnnouncedPostSchema },
    ]),
    RabbitModule,
    AuthModule,
  ],
  controllers: [MailingController],
  providers: [
    NotificationRepository,
    NotificationMailer,
    NotifyTriggerGuard,
    MailingRepository,
    MailingService,
  ],
})
export class AppModule {}
