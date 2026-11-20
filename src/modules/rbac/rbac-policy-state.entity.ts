import {
  Check,
  Column,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * The policy version: a single row (`id = 1`) created by the migration.
 * Every RBAC change increments `version` in the same transaction, and each
 * app instance reloads its policy snapshot when it sees a newer version.
 */
@Check('CHK_rbac_policy_state_single_row', `"id" = 1`)
@Check('CHK_rbac_policy_state_version', `"version" >= 0`)
@Entity('rbac_policy_state')
export class RbacPolicyState {
  @PrimaryColumn({ type: 'integer' })
  id: number;

  /**
   * `bigint` comes back from the pg driver as a string, which would compare
   * wrongly ('10' < '9'). It is read as a number: safe up to 2^53, far more
   * changes than the policy will ever have.
   */
  @Column({
    type: 'bigint',
    default: 0,
    transformer: {
      to: (value: number) => value,
      from: (value: string) => Number(value),
    },
  })
  version: number;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
