import { ApiProperty } from '@nestjs/swagger';
import { mailingStatuses } from './mailing.model';
import type { MailingStatus } from './mailing.model';

import {
  IsEmail,
  IsISO8601,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export const ENQUEUE_EMAIL = 'notify.email.enqueue';

export class EmailNotificationDto {
  @IsUUID('4')
  notificationId!: string;

  @IsEmail()
  recipientEmail!: string;

  @Length(1, 200)
  @Matches(/\S/)
  @Matches(/^[^\r\n]*$/)
  subject!: string;

  @Length(1, 100000)
  text!: string;

  @ValidateIf((_object, value) => value !== undefined)
  @MaxLength(100000)
  html?: string;

  @ValidateIf((_object, value) => value !== undefined)
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(/T.*(?:Z|[+-]\d{2}:\d{2})$/)
  scheduledAt?: string;
}

export class MailingResponseDto {
  @ApiProperty({ type: String, format: 'uuid' }) runId!: string;
  @ApiProperty({ type: String, enum: mailingStatuses }) status!: MailingStatus;
  @ApiProperty({ type: Number, minimum: 0 }) recipientCount!: number;
  @ApiProperty({ type: Number, minimum: 0 }) publicationCount!: number;
  @ApiProperty({ type: Number, minimum: 0 }) sentCount!: number;
  @ApiProperty({ type: Number, minimum: 0 }) pendingCount!: number;
}
