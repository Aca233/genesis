ALTER TABLE "genesis_tasks"
  ADD COLUMN "engine_version" TEXT NOT NULL DEFAULT 'legacy-v1',
  ADD COLUMN "aggregate_version" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "genesis_jobs" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "genesis_task_id" TEXT NOT NULL,
  "node_key" TEXT NOT NULL,
  "engine_version" TEXT NOT NULL,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "dependency_keys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "input_hash" TEXT,
  "lease_token" TEXT,
  "lease_epoch" INTEGER NOT NULL DEFAULT 0,
  "lease_expires_at" TIMESTAMP(3),
  "attempt" INTEGER NOT NULL DEFAULT 0,
  "estimated_duration" INTEGER,
  "estimated_tokens" INTEGER,
  "started_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "genesis_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "genesis_jobs_genesis_task_id_fkey" FOREIGN KEY ("genesis_task_id") REFERENCES "genesis_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "genesis_outbox" (
  "event_id" TEXT NOT NULL,
  "task_id" TEXT NOT NULL,
  "aggregate_version" INTEGER NOT NULL,
  "event_type" TEXT NOT NULL,
  "payload_projection" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "published_at" TIMESTAMP(3),
  "delivery_attempts" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "genesis_outbox_pkey" PRIMARY KEY ("event_id"),
  CONSTRAINT "genesis_outbox_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "genesis_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "genesis_jobs_genesis_task_id_node_key_key" ON "genesis_jobs"("genesis_task_id", "node_key");
CREATE INDEX "genesis_jobs_status_priority_created_at_idx" ON "genesis_jobs"("status", "priority", "created_at");
CREATE INDEX "genesis_jobs_user_id_status_idx" ON "genesis_jobs"("user_id", "status");
CREATE INDEX "genesis_jobs_lease_expires_at_idx" ON "genesis_jobs"("lease_expires_at");
CREATE UNIQUE INDEX "genesis_outbox_task_id_aggregate_version_key" ON "genesis_outbox"("task_id", "aggregate_version");
CREATE INDEX "genesis_outbox_task_id_created_at_idx" ON "genesis_outbox"("task_id", "created_at");
CREATE INDEX "genesis_outbox_published_at_created_at_idx" ON "genesis_outbox"("published_at", "created_at");

INSERT INTO "genesis_jobs" (
  "id", "user_id", "genesis_task_id", "node_key", "engine_version", "status",
  "lease_token", "lease_epoch", "lease_expires_at", "attempt", "started_at", "completed_at", "error", "updated_at"
)
SELECT
  'legacy_' || "id", "user_id", "id", 'legacy-world-deck', 'legacy-v1',
  CASE WHEN "status" IN ('completed', 'failed', 'cancelled') THEN "status" ELSE 'queued' END,
  NULL, 0, NULL, "attempt",
  CASE WHEN "status" IN ('running', 'repairing', 'completed', 'failed') THEN "updated_at" ELSE NULL END,
  CASE WHEN "status" IN ('completed', 'failed', 'cancelled') THEN "updated_at" ELSE NULL END,
  "error", "updated_at"
FROM "genesis_tasks";
