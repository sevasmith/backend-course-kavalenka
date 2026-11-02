import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { QueryFailedError } from 'typeorm';
import { User } from './user.entity';
import { UsersService } from './users.service';
import { UserStatus } from './user.types';

describe('UsersService', () => {
  let service: UsersService;
  let repository: { create: jest.Mock; save: jest.Mock };

  const data = {
    email: 'user@example.com',
    passwordHash: 'hash',
    status: UserStatus.ACTIVE,
  };

  beforeEach(async () => {
    repository = {
      create: jest.fn((input: unknown) => input),
      save: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: repository },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('throws ConflictException on a unique violation', async () => {
    const driverError = Object.assign(new Error('duplicate key'), {
      code: '23505',
    });
    repository.save.mockRejectedValue(
      new QueryFailedError('INSERT ...', [], driverError),
    );

    await expect(service.createUser(data)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('rethrows other errors unchanged', async () => {
    const error = new Error('connection lost');
    repository.save.mockRejectedValue(error);

    await expect(service.createUser(data)).rejects.toBe(error);
  });
});
