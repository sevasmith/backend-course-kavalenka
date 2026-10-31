export enum UserStatus {
  PENDING = 'pending',
  ACTIVE = 'active',
  BLOCKED = 'blocked',
  DELETING = 'deleting',
  DELETED = 'deleted',
}

export interface CreateUserData {
  email: string;
  passwordHash: string;
  status: UserStatus;
}
