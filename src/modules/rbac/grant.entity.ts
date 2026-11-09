import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

import { Permission } from './permission.entity';
import { Role } from './role.entity';

/**
 * Gives a role a permission: all of its actions (`allActions = true`, no
 * `grant_actions` rows) or only the actions listed in `grant_actions`.
 * The service keeps these two cases consistent; the DB can't.
 *
 * The unique pair covers lookups by `role_id`. `permission_id` is second in
 * it, so it gets its own index for the "permission in use" check.
 */
@Unique('UQ_grants_role_id_permission_id', ['roleId', 'permissionId'])
@Index('IDX_grants_permission_id', ['permissionId'])
@Entity('grants')
export class Grant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'role_id', type: 'uuid' })
  roleId: string;

  @ManyToOne(() => Role, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'role_id' })
  role: Role;

  @Column({ name: 'permission_id', type: 'uuid' })
  permissionId: string;

  @ManyToOne(() => Permission, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'permission_id' })
  permission: Permission;

  @Column({ name: 'all_actions', type: 'boolean', default: false })
  allActions: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
