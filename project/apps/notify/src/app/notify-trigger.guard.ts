import { Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '@project/shared-core';
import { timingSafeEqual } from 'node:crypto';

@Injectable()
export class NotifyTriggerGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService,
    private readonly users: JwtAuthGuard,
  ) {}

  canActivate(context: ExecutionContext) {
    const request = context
      .switchToHttp()
      .getRequest<{ headers: { authorization?: string } }>();
    const token = /^Bearer\s+(\S+)$/i.exec(
      request.headers.authorization ?? '',
    )?.[1];
    const expected = Buffer.from(
      this.config.getOrThrow<string>('NOTIFY_HTTP_TOKEN'),
    );
    const actual = Buffer.from(token ?? '');
    if (actual.length === expected.length && timingSafeEqual(actual, expected))
      return true;
    return this.users.canActivate(context);
  }
}
