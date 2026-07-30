ALTER TABLE "genesis_tasks"
  ADD COLUMN "shadow_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "shadow_status" TEXT NOT NULL DEFAULT $$disabled$$,
  ADD COLUMN "shadow_preflight" JSONB,
  ADD COLUMN "shadow_preflight_hash" TEXT,
  ADD COLUMN "shadow_budget_max_calls" INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN "shadow_budget_max_input_tokens" INTEGER NOT NULL DEFAULT 120000,
  ADD COLUMN "shadow_budget_max_output_tokens" INTEGER NOT NULL DEFAULT 30000,
  ADD COLUMN "shadow_budget_call_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "shadow_budget_reserved_input_tokens" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "shadow_budget_reserved_output_tokens" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "shadow_budget_settled_input_tokens" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "shadow_budget_settled_output_tokens" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "llm_attempts"
  ADD COLUMN "budget_scope" TEXT NOT NULL DEFAULT $$primary$$;

CREATE TABLE "genesis_artifacts" (
  "id" TEXT NOT NULL,
  "genesis_task_id" TEXT NOT NULL,
  "genesis_job_id" TEXT,
  "stage_key" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT $$candidate$$,
  "visibility" TEXT NOT NULL DEFAULT $$shadow$$,
  "input_hash" TEXT NOT NULL,
  "output_hash" TEXT NOT NULL,
  "reuse_key" TEXT NOT NULL,
  "dependency_hashes" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "content" JSONB NOT NULL,
  "validation" JSONB,
  "accepted_at" TIMESTAMP(3),
  "superseded_at" TIMESTAMP(3),
  "sealed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "genesis_artifacts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "genesis_artifacts_genesis_task_id_fkey" FOREIGN KEY ("genesis_task_id") REFERENCES "genesis_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "genesis_artifacts_genesis_job_id_fkey" FOREIGN KEY ("genesis_job_id") REFERENCES "genesis_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "genesis_artifacts_genesis_task_id_stage_key_version_key"
  ON "genesis_artifacts"("genesis_task_id", "stage_key", "version");
CREATE INDEX "genesis_artifacts_genesis_task_id_stage_key_status_idx"
  ON "genesis_artifacts"("genesis_task_id", "stage_key", "status");
CREATE INDEX "genesis_artifacts_reuse_key_status_idx"
  ON "genesis_artifacts"("reuse_key", "status");
CREATE UNIQUE INDEX "genesis_artifacts_one_accepted_per_stage_key"
  ON "genesis_artifacts"("genesis_task_id", "stage_key")
  WHERE "status" IN ($$accepted$$, $$sealed$$);
