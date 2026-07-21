ALTER TABLE "llm_calls"
  ADD COLUMN "provider" TEXT,
  ADD COLUMN "model" TEXT,
  ADD COLUMN "input_tokens" INTEGER,
  ADD COLUMN "output_tokens" INTEGER,
  ADD COLUMN "cache_read_tokens" INTEGER,
  ADD COLUMN "cache_write_tokens" INTEGER,
  ADD COLUMN "cache_requested" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "cache_fallback" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "llm_calls_task_created_at_idx" ON "llm_calls"("task", "created_at");
