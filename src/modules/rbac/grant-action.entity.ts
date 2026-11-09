import { Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';

import { Grant } from './grant.entity';
import { PermissionAction } from './permission-action.entity';

/**
 * Junction table: the explicit actions of a grant with `allActions = false`.
 *
 * RESTRICT on the action: an action used by a grant can't be deleted, so
 * nobody loses access silently. The service checks this first and returns 409.
 * The action must belong to the grant's permission; the service checks that.
 */
@Index('IDX_grant_actions_permission_action_id', ['permissionActionId'])
@Entity('grant_actions')
export class GrantAction {
  @PrimaryColumn({ name: 'grant_id', type: 'uuid' })
  grantId: string;

  @ManyToOne(() => Grant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'grant_id' })
  grant: Grant;

  @PrimaryColumn({ name: 'permission_action_id', type: 'uuid' })
  permissionActionId: string;

  @ManyToOne(() => PermissionAction, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'permission_action_id' })
  permissionAction: PermissionAction;
}
