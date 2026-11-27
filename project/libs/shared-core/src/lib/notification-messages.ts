import { plainToInstance, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEmail,
  IsISO8601,
  IsInt,
  IsMongoId,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
  validateSync,
} from 'class-validator';

export const NotificationEvent = {
  SendQueued: 'notify.email.send',
  UsersRequest: 'notify.users.snapshot',
  UsersPage: 'notify.users.snapshot.page',
  PostsRequest: 'notify.posts.snapshot',
  PostsPage: 'notify.posts.snapshot.page',
  Continue: 'notify.digest.continue',
} as const;

export class InvalidBrokerMessageError extends Error {}

export class RunMessage {
  @IsUUID('4')
  runId!: string;
}

class SnapshotRequest extends RunMessage {
  @IsInt()
  @Min(1)
  @Max(1000)
  limit!: number;
}

export class UsersSnapshotRequest extends SnapshotRequest {
  @ValidateIf((_object, value) => value !== undefined)
  @IsMongoId()
  after?: string;
}

export class PostsSnapshotRequest extends SnapshotRequest {
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/)
  from!: string;

  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/)
  to!: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsUUID('4')
  after?: string;
}

export class MailingRecipient {
  @IsMongoId()
  id!: string;

  @IsEmail()
  email!: string;
}

export class MailingPublication {
  @IsUUID('4')
  id!: string;

  @IsString()
  @Length(1, 1000)
  title!: string;

  @IsISO8601({ strict: true, strictSeparator: true })
  publishedAt!: string;
}

export class UsersSnapshotPage extends RunMessage {
  @ValidateIf((_object, value) => value !== undefined)
  @IsMongoId()
  after?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsMongoId()
  nextAfter?: string;

  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => MailingRecipient)
  items!: MailingRecipient[];
}

export class PostsSnapshotPage extends RunMessage {
  @ValidateIf((_object, value) => value !== undefined)
  @IsUUID('4')
  after?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsUUID('4')
  nextAfter?: string;

  @IsArray()
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => MailingPublication)
  items!: MailingPublication[];
}

export function parseBrokerMessage<T extends object>(
  dto: new () => T,
  payload: unknown,
): T {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    throw new InvalidBrokerMessageError('Ожидается объект сообщения');
  const value = plainToInstance(dto, payload);
  if (
    validateSync(value, {
      whitelist: true,
      forbidNonWhitelisted: true,
      validationError: { target: false, value: false },
    }).length
  )
    throw new InvalidBrokerMessageError('Некорректное сообщение');
  return value;
}

export function validateSnapshotPage(page: {
  after?: string;
  nextAfter?: string;
  items: { id: string }[];
}) {
  let previous = page.after ?? '';
  for (const item of page.items) {
    if (item.id <= previous)
      throw new InvalidBrokerMessageError('Нарушен порядок страницы');
    previous = item.id;
  }
  if (
    page.nextAfter !== undefined &&
    (!page.items.length || page.nextAfter !== previous)
  )
    throw new InvalidBrokerMessageError('Некорректный курсор страницы');
}
