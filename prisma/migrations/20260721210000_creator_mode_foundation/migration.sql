-- Existing worlds and genesis tasks remain pantheon worlds. No player god or
-- rewrite row is synthesized by this migration.
ALTER TABLE "worlds"
  ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'pantheon',
  ADD COLUMN "operation_kind" TEXT,
  ADD COLUMN "operation_token" TEXT,
  ADD COLUMN "operation_lease_expires_at" TIMESTAMP(3);

ALTER TABLE "genesis_tasks"
  ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'pantheon';

ALTER TABLE "timelines"
  ADD COLUMN "branch_name" TEXT NOT NULL DEFAULT '原初现实',
  ADD COLUMN "branch_summary" TEXT,
  ADD COLUMN "reality_state" JSONB,
  ADD COLUMN "observer_state" JSONB,
  ADD COLUMN "fork_rewrite_id" TEXT,
  ADD COLUMN "updated_at" TIMESTAMP(3);

UPDATE "timelines" SET "updated_at" = "created_at" WHERE "updated_at" IS NULL;
ALTER TABLE "timelines" ALTER COLUMN "updated_at" SET NOT NULL;

ALTER TABLE "entities"
  ADD COLUMN "is_creator_avatar" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "reality_rewrites" (
  "id" TEXT NOT NULL,
  "world_id" TEXT NOT NULL,
  "source_timeline_id" TEXT NOT NULL,
  "result_timeline_id" TEXT,
  "source_chapter_id" TEXT NOT NULL,
  "decree" TEXT NOT NULL,
  "scope" TEXT NOT NULL DEFAULT 'prospective',
  "status" TEXT NOT NULL DEFAULT 'planning',
  "plan" JSONB,
  "summary" TEXT,
  "idempotency_key" TEXT NOT NULL,
  "lease_token" TEXT,
  "lease_expires_at" TIMESTAMP(3),
  "error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "reality_rewrites_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "timelines_fork_rewrite_id_key" ON "timelines"("fork_rewrite_id");
CREATE UNIQUE INDEX "reality_rewrites_result_timeline_id_key" ON "reality_rewrites"("result_timeline_id");
CREATE UNIQUE INDEX "reality_rewrites_idempotency_key_key" ON "reality_rewrites"("idempotency_key");
CREATE INDEX "reality_rewrites_world_id_created_at_idx" ON "reality_rewrites"("world_id", "created_at");
CREATE INDEX "reality_rewrites_status_lease_expires_at_idx" ON "reality_rewrites"("status", "lease_expires_at");

ALTER TABLE "reality_rewrites" ADD CONSTRAINT "reality_rewrites_world_id_fkey"
  FOREIGN KEY ("world_id") REFERENCES "worlds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reality_rewrites" ADD CONSTRAINT "reality_rewrites_source_timeline_id_fkey"
  FOREIGN KEY ("source_timeline_id") REFERENCES "timelines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reality_rewrites" ADD CONSTRAINT "reality_rewrites_result_timeline_id_fkey"
  FOREIGN KEY ("result_timeline_id") REFERENCES "timelines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "timelines" ADD CONSTRAINT "timelines_fork_rewrite_id_fkey"
  FOREIGN KEY ("fork_rewrite_id") REFERENCES "reality_rewrites"("id") ON DELETE SET NULL ON UPDATE CASCADE;
