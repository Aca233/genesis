ALTER TABLE "genesis_tasks"
  ADD COLUMN "idempotency_key" TEXT,
  ADD COLUMN "request_hash" TEXT,
  ADD COLUMN "raw_expires_at" TIMESTAMP(3);

CREATE UNIQUE INDEX "genesis_tasks_user_id_idempotency_key_key"
  ON "genesis_tasks"("user_id", "idempotency_key");

CREATE INDEX "genesis_tasks_raw_expires_at_idx"
  ON "genesis_tasks"("raw_expires_at");
