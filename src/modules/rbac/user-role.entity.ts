import { Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';

import { User } from '../users/user.entity';
import { Role } from './role.entity';

/**
 * Junction table: the roles of a user.
 *
 * The primary key starts with `user_id`, which serves the hot path
 * ("roles of this user"). `role_id` gets its own index for the "role in use"
 * check and the `rbac@manage` invariant query.
 * RESTRICT on the role: an assigned role can't be deleted.
 */
@Index('IDX_user_roles_role_id', ['roleId'])
@Entity('user_roles')
export class UserRole {
  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @PrimaryColumn({ name: 'role_id', type: 'uuid' })
  roleId: string;

  @ManyToOne(() => Role, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'role_id' })
  role: Role;
}
