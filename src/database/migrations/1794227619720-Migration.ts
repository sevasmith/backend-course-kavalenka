import { MigrationInterface, QueryRunner } from 'typeorm';

export class Migration1794227619720 implements MigrationInterface {
  name = 'Migration1794227619720';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "roles" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" text NOT NULL, "description" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_648e3f5447f725579d7d4ffdfb7" UNIQUE ("name"), CONSTRAINT "CHK_roles_description_length" CHECK (char_length("description") <= 500), CONSTRAINT "PK_c1433d71a4838793a49dcad46ab" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "user_roles" ("user_id" uuid NOT NULL, "role_id" uuid NOT NULL, CONSTRAINT "PK_23ed6f04fe43066df08379fd034" PRIMARY KEY ("user_id", "role_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_user_roles_role_id" ON "user_roles" ("role_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "rbac_policy_state" ("id" integer NOT NULL, "version" bigint NOT NULL DEFAULT '0', "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "CHK_rbac_policy_state_version" CHECK ("version" >= 0), CONSTRAINT "CHK_rbac_policy_state_single_row" CHECK ("id" = 1), CONSTRAINT "PK_e3d1655eafaa233081c7825dcd0" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "permissions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" text NOT NULL, "description" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_48ce552495d14eae9b187bb6716" UNIQUE ("name"), CONSTRAINT "CHK_permissions_description_length" CHECK (char_length("description") <= 500), CONSTRAINT "PK_920331560282b8bd21bb02290df" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "permission_actions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "permission_id" uuid NOT NULL, "name" text NOT NULL, CONSTRAINT "UQ_permission_actions_permission_id_name" UNIQUE ("permission_id", "name"), CONSTRAINT "PK_cae6310cc710b5f14dcb78c0766" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "grants" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "role_id" uuid NOT NULL, "permission_id" uuid NOT NULL, "all_actions" boolean NOT NULL DEFAULT false, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_grants_role_id_permission_id" UNIQUE ("role_id", "permission_id"), CONSTRAINT "PK_a25f5f89eff8b3277f7969b7094" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_grants_permission_id" ON "grants" ("permission_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "grant_actions" ("grant_id" uuid NOT NULL, "permission_action_id" uuid NOT NULL, CONSTRAINT "PK_e94f346e9e9169ac6433f2139a6" PRIMARY KEY ("grant_id", "permission_action_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_grant_actions_permission_action_id" ON "grant_actions" ("permission_action_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "user_roles" ADD CONSTRAINT "FK_87b8888186ca9769c960e926870" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_roles" ADD CONSTRAINT "FK_b23c65e50a758245a33ee35fda1" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "permission_actions" ADD CONSTRAINT "FK_f6a0d0a3357be97b66e0d817aeb" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "grants" ADD CONSTRAINT "FK_6ad105ae2334a61cb9e149dfd39" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "grants" ADD CONSTRAINT "FK_d05abea3378df765d5d0e4bb585" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "grant_actions" ADD CONSTRAINT "FK_526285225073d1d4b9d7daa87bb" FOREIGN KEY ("grant_id") REFERENCES "grants"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "grant_actions" ADD CONSTRAINT "FK_254cceacc5f3a85da1eb85781e2" FOREIGN KEY ("permission_action_id") REFERENCES "permission_actions"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    // The single policy-version row. Generated migrations never contain data.
    await queryRunner.query(
      `INSERT INTO "rbac_policy_state" ("id", "version") VALUES (1, 0)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "grant_actions" DROP CONSTRAINT "FK_254cceacc5f3a85da1eb85781e2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "grant_actions" DROP CONSTRAINT "FK_526285225073d1d4b9d7daa87bb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "grants" DROP CONSTRAINT "FK_d05abea3378df765d5d0e4bb585"`,
    );
    await queryRunner.query(
      `ALTER TABLE "grants" DROP CONSTRAINT "FK_6ad105ae2334a61cb9e149dfd39"`,
    );
    await queryRunner.query(
      `ALTER TABLE "permission_actions" DROP CONSTRAINT "FK_f6a0d0a3357be97b66e0d817aeb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_roles" DROP CONSTRAINT "FK_b23c65e50a758245a33ee35fda1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_roles" DROP CONSTRAINT "FK_87b8888186ca9769c960e926870"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_grant_actions_permission_action_id"`,
    );
    await queryRunner.query(`DROP TABLE "grant_actions"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_grants_permission_id"`);
    await queryRunner.query(`DROP TABLE "grants"`);
    await queryRunner.query(`DROP TABLE "permission_actions"`);
    await queryRunner.query(`DROP TABLE "permissions"`);
    await queryRunner.query(`DROP TABLE "rbac_policy_state"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_user_roles_role_id"`);
    await queryRunner.query(`DROP TABLE "user_roles"`);
    await queryRunner.query(`DROP TABLE "roles"`);
  }
}
