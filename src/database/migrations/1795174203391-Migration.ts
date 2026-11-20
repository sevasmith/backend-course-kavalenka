import { MigrationInterface, QueryRunner } from 'typeorm';

export class Migration1795174203391 implements MigrationInterface {
  name = 'Migration1795174203391';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."login_challenge_method" AS ENUM('otp', 'magic_link')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."login_challenge_consumed_reason" AS ENUM('confirmed', 'replaced', 'attempts_exhausted', 'user_inactive')`,
    );
    await queryRunner.query(
      `CREATE TABLE "login_challenges" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "method" "public"."login_challenge_method" NOT NULL, "secret_hash" text NOT NULL, "last_sent_at" TIMESTAMP WITH TIME ZONE NOT NULL, "attempts" integer NOT NULL DEFAULT '0', "consumed_at" TIMESTAMP WITH TIME ZONE, "consumed_reason" "public"."login_challenge_consumed_reason", "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_85b9467d340eb112cb0fa7a0cde" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_login_challenges_user_id_unconsumed" ON "login_challenges" ("user_id") WHERE "consumed_at" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "login_challenges" ADD CONSTRAINT "FK_23bb9553efaa83910672d214f65" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "login_challenges" DROP CONSTRAINT "FK_23bb9553efaa83910672d214f65"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_login_challenges_user_id_unconsumed"`,
    );
    await queryRunner.query(`DROP TABLE "login_challenges"`);
    await queryRunner.query(
      `DROP TYPE "public"."login_challenge_consumed_reason"`,
    );
    await queryRunner.query(`DROP TYPE "public"."login_challenge_method"`);
  }
}
