ALTER TABLE "generation_requests"
  ADD COLUMN "stage" TEXT NOT NULL DEFAULT 'reserved',
  ADD COLUMN "output_snapshot" JSONB,
  ADD COLUMN "retryable" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "safe_error" TEXT,
  ADD COLUMN "stage_updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "generation_requests"
SET "stage" = CASE
  WHEN "status" = 'completed' THEN 'completed'
  ELSE 'reserved'
END;

CREATE INDEX "generation_requests_chapter_id_stage_idx"
  ON "generation_requests"("chapter_id", "stage");

ALTER TABLE "chapters"
  ADD COLUMN "settle_error" TEXT,
  ADD COLUMN "settle_retryable" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "settle_updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
