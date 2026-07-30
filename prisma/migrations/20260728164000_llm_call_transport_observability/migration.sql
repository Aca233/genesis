ALTER TABLE "llm_calls"
  ADD COLUMN "logical_call_id" TEXT,
  ADD COLUMN "physical_attempt_index" INTEGER,
  ADD COLUMN "transport_kind" TEXT,
  ADD COLUMN "transport_outcome" TEXT,
  ADD COLUMN "terminal_evidence" TEXT,
  ADD COLUMN "stable_error_code" TEXT;

CREATE INDEX "llm_calls_logical_call_id_idx"
  ON "llm_calls"("logical_call_id");

CREATE INDEX "llm_calls_transport_outcome_created_at_idx"
  ON "llm_calls"("transport_outcome", "created_at");

CREATE UNIQUE INDEX "llm_calls_logical_call_id_physical_attempt_index_key"
  ON "llm_calls"("logical_call_id", "physical_attempt_index");
