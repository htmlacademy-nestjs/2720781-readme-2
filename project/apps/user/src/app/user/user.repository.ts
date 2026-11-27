import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, mongo } from 'mongoose';
import { UserEntity } from './user.entity';
import { UserModel } from './user.model';
import type { UserDocument } from './user.model';
import type { NewUser } from './user.types';

@Injectable()
export class UserRepository {
  constructor(
    @InjectModel(UserModel.name) private readonly users: Model<UserModel>,
  ) {}

  async findById(id: string) {
    const user = await this.users.findById(id).exec();
    return user ? this.toEntity(user) : null;
  }

  async findByEmail(email: string) {
    const user = await this.users.findOne({ email }).exec();
    return user ? this.toEntity(user) : null;
  }

  async findMailingUsers(request: { after?: string; limit: number }) {
    const users = await this.users
      .find({
        ...(request.after ? { _id: { $gt: request.after } } : {}),
      })
      .select({ _id: 1, email: 1 })
      .sort({ _id: 1 })
      .limit(request.limit)
      .lean()
      .exec();
    return users.map((user) => ({
      id: user._id.toString(),
      email: user.email,
    }));
  }

  async create(input: NewUser) {
    await this.users.init();
    try {
      return this.toEntity(await this.users.create(input));
    } catch (error) {
      if (error instanceof mongo.MongoServerError && error.code === 11000)
        return null;
      throw error;
    }
  }

  async saveRefreshToken(id: string, refreshTokenHash: string) {
    await this.users.updateOne({ _id: id }, { refreshTokenHash }).exec();
  }

  async consumeRefreshToken(id: string, refreshTokenHash: string) {
    const user = await this.users
      .findOneAndUpdate(
        { _id: id, refreshTokenHash },
        { $unset: { refreshTokenHash: 1 } },
        { returnDocument: 'after' },
      )
      .exec();
    return user ? this.toEntity(user) : null;
  }

  async clearRefreshToken(id: string) {
    await this.users
      .updateOne({ _id: id }, { $unset: { refreshTokenHash: 1 } })
      .exec();
  }

  async updatePassword(id: string, passwordHash: string) {
    await this.users
      .updateOne(
        { _id: id },
        { $set: { passwordHash }, $unset: { refreshTokenHash: 1 } },
      )
      .exec();
  }

  private toEntity(user: UserDocument) {
    return new UserEntity({
      id: user._id.toString(),
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      avatarUrl: user.avatarUrl,
      registeredAt: user.registeredAt.toISOString(),
      passwordHash: user.passwordHash,
    });
  }
}
