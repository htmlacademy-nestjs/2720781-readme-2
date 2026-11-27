import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule, RabbitModule } from '@project/shared-core';
import { MailingSourceController } from './mailing-source.controller';
import { UserController } from './user.controller';
import { UserModel, UserSchema } from './user.model';
import { UserRepository } from './user.repository';
import { UserService } from './user.service';

@Module({
  imports: [
    AuthModule,
    RabbitModule,
    MongooseModule.forFeature([{ name: UserModel.name, schema: UserSchema }]),
  ],
  controllers: [UserController, MailingSourceController],
  providers: [UserRepository, UserService],
  exports: [UserRepository],
})
export class UserModule {}
