export { AuthModule } from './lib/auth.module';
export { AnonymousOnlyGuard } from './lib/anonymous-only.guard';
export { CurrentUserId } from './lib/current-user-id.decorator';
export { JwtAuthGuard } from './lib/jwt-auth.guard';
export { ServiceAuthGuard } from './lib/service-auth.guard';
export { MongoIdValidationPipe } from './lib/mongo-id-validation.pipe';
export { PageQueryDto } from './lib/page-query.dto';
export { RelatedServiceUnavailableError } from './lib/related-service.error';
export {
  RabbitModule,
  RabbitPublisher,
  rabbitServerOptions,
  rabbitQueueOptions,
  handleRabbitEvent,
} from './lib/rabbitmq';
export type { NotificationQueueKey } from './lib/rabbitmq';
export {
  NotificationEvent,
  InvalidBrokerMessageError,
  RunMessage,
  UsersSnapshotRequest,
  PostsSnapshotRequest,
  UsersSnapshotPage,
  PostsSnapshotPage,
  MailingRecipient,
  MailingPublication,
  parseBrokerMessage,
  validateSnapshotPage,
} from './lib/notification-messages';
