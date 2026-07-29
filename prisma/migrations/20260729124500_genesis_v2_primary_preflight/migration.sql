ALTER TABLE "genesis_tasks"
  ADD COLUMN "preflight" JSONB,
  ADD COLUMN "preflight_hash" TEXT;
