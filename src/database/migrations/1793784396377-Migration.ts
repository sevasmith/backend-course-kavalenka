import { MigrationInterface, QueryRunner } from 'typeorm';

export class Migration1793784396377 implements MigrationInterface {
  name = 'Migration1793784396377';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."registration_challenge_consumed_reason" AS ENUM('confirmed', 'replaced', 'attempts_exhausted', 'user_inactive')`,
    );
    await queryRunner.query(
      `ALTER TABLE "registration_challenges" ADD "consumed_reason" "public"."registration_challenge_consumed_reason"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "registration_challenges" DROP COLUMN "consumed_reason"`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."registration_challenge_consumed_reason"`,
    );
  }
}
