import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from './user.entity';
import { Repository } from 'typeorm';
import { isUniqueViolation } from '@/core/database/pg-errors';
import { CreateUserData, UserStatus } from './user.types';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly usersRepository: Repository<User>,
  ) {}

  async createUser(data: CreateUserData): Promise<User> {
    const user = this.usersRepository.create(data);

    try {
      return await this.usersRepository.save(user);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('Email is already registered');
      }
      throw error;
    }
  }

  findByEmail(email: string): Promise<User | null> {
    return this.usersRepository.findOne({ where: { email } });
  }

  /**
   * Locks the user row until the transaction ends, so the status cannot change
   * between the check and the update. Must be called inside a transaction.
   */
  findByIdForUpdate(id: string): Promise<User | null> {
    return this.usersRepository.findOne({
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
  }

  async updateStatus(id: string, status: UserStatus): Promise<void> {
    await this.usersRepository.update(id, { status });
  }
}
