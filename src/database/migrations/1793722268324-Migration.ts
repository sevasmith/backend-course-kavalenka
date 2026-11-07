import { MigrationInterface, QueryRunner } from 'typeorm';

export class Migration1793722268324 implements MigrationInterface {
  name = 'Migration1793722268324';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_registration_challenges_magic_link_secret_hash" ON "registration_challenges" ("secret_hash") WHERE "method" = 'magic_link'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_registration_challenges_magic_link_secret_hash"`,
    );
  }
}
