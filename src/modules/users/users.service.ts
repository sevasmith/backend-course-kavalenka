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
   *
   * `FOR NO KEY UPDATE`, not `FOR UPDATE`: it still blocks other writers of
   * this row, but not the foreign key checks of inserts that reference it
   * (e.g. `user_roles`). With `FOR UPDATE`, a confirmation (user row, then
   * the RBAC state row) and an admin role change for the same user (state
   * row, then the user's FK check) could deadlock. Enough here, because the
   * id is never changed.
   */
  findByIdForUpdate(id: string): Promise<User | null> {
    return this.usersRepository.findOne({
      where: { id },
      lock: { mode: 'for_no_key_update' },
    });
  }

  async updateStatus(id: string, status: UserStatus): Promise<void> {
    await this.usersRepository.update(id, { status });
  }
}
