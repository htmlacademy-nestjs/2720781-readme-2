import { Module } from '@nestjs/common';
import { AuthModule, RabbitModule } from '@project/shared-core';
import { MailingSourceController } from './mailing-source.controller';
import { ReactionsClient } from '../clients/reactions.client';
import { PostRepository } from './post.repository';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';

@Module({
  imports: [AuthModule, RabbitModule],
  controllers: [PostsController, MailingSourceController],
  providers: [PostsService, PostRepository, ReactionsClient],
})
export class PostsModule {}
