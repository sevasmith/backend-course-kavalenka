import { MigrationInterface, QueryRunner } from 'typeorm';

export class Migration1793704104678 implements MigrationInterface {
  name = 'Migration1793704104678';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."registration_challenge_method" AS ENUM('otp', 'magic_link')`,
    );
    await queryRunner.query(
      `CREATE TABLE "registration_challenges" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "user_id" uuid NOT NULL, "method" "public"."registration_challenge_method" NOT NULL, "secret_hash" text NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "attempts" integer NOT NULL DEFAULT '0', "last_sent_at" TIMESTAMP WITH TIME ZONE NOT NULL, "consumed_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_d6fa191ff3d39187fdd4f889406" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_518c0664929d6d414210cd2ac3" ON "registration_challenges" ("user_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "registration_challenges" ADD CONSTRAINT "FK_518c0664929d6d414210cd2ac30" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "registration_challenges" DROP CONSTRAINT "FK_518c0664929d6d414210cd2ac30"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_518c0664929d6d414210cd2ac3"`,
    );
    await queryRunner.query(`DROP TABLE "registration_challenges"`);
    await queryRunner.query(
      `DROP TYPE "public"."registration_challenge_method"`,
    );
  }
}
