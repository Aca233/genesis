-- 多租户 Phase A 最终化：属主列禁止继续依赖 "local" 默认值，并关联 better-auth 用户。
DO $$
DECLARE
  remaining bigint;
BEGIN
  SELECT
    (SELECT count(*) FROM "worlds" WHERE "user_id" = 'local')
    + (SELECT count(*) FROM "genesis_tasks" WHERE "user_id" = 'local')
    + (SELECT count(*) FROM "material_cards" WHERE "user_id" = 'local')
    + (SELECT count(*) FROM "settings" WHERE "user_id" = 'local')
    + (SELECT count(*) FROM "lore_index_entries" WHERE "user_id" = 'local')
  INTO remaining;

  IF remaining > 0 THEN
    RAISE EXCEPTION '仍有 % 行 user_id=local；先运行 scripts/backfill-local-to-owner.mjs', remaining;
  END IF;
END $$;

ALTER TABLE "worlds" ALTER COLUMN "user_id" DROP DEFAULT;
ALTER TABLE "genesis_tasks" ALTER COLUMN "user_id" DROP DEFAULT;
ALTER TABLE "material_cards" ALTER COLUMN "user_id" DROP DEFAULT;
ALTER TABLE "settings" ALTER COLUMN "user_id" DROP DEFAULT;
ALTER TABLE "lore_index_entries" ALTER COLUMN "user_id" DROP DEFAULT;

ALTER TABLE "worlds" ADD CONSTRAINT "worlds_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "genesis_tasks" ADD CONSTRAINT "genesis_tasks_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "material_cards" ADD CONSTRAINT "material_cards_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "settings" ADD CONSTRAINT "settings_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lore_index_entries" ADD CONSTRAINT "lore_index_entries_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
