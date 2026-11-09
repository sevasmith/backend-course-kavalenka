import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

import { Permission } from './permission.entity';

/**
 * An action of a permission, e.g. `read` of `users`. Action names are unique
 * within their permission only. The unique index starts with `permission_id`,
 * so it also serves "all actions of a permission" lookups.
 */
@Unique('UQ_permission_actions_permission_id_name', ['permissionId', 'name'])
@Entity('permission_actions')
export class PermissionAction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'permission_id', type: 'uuid' })
  permissionId: string;

  @ManyToOne(() => Permission, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'permission_id' })
  permission: Permission;

  @Column({ type: 'text' })
  name: string;
}
