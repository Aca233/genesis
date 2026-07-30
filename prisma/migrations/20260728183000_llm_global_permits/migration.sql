ALTER TABLE "genesis_tasks"
  ADD COLUMN "budget_max_calls" INTEGER NOT NULL DEFAULT 12,
  ADD COLUMN "budget_max_input_tokens" INTEGER NOT NULL DEFAULT 500000,
  ADD COLUMN "budget_max_output_tokens" INTEGER NOT NULL DEFAULT 65536,
  ADD COLUMN "budget_call_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "budget_reserved_input_tokens" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "budget_reserved_output_tokens" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "budget_settled_input_tokens" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "budget_settled_output_tokens" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "llm_attempts" (
  "id" TEXT NOT NULL,
  "logical_call_id" TEXT NOT NULL,
  "physical_attempt_index" INTEGER NOT NULL,
  "used_slot_no" INTEGER NOT NULL,
  "slot_epoch" INTEGER NOT NULL,
  "cache_isolation_domain" TEXT NOT NULL,
  "endpoint_key" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "task_class" TEXT NOT NULL,
  "owner_kind" TEXT NOT NULL,
  "owner_id" TEXT NOT NULL,
  "genesis_task_id" TEXT,
  "genesis_job_id" TEXT,
  "user_id" TEXT NOT NULL,
  "lease_epoch" INTEGER,
  "state" TEXT NOT NULL DEFAULT $$reserved$$,
  "transport_kind" TEXT NOT NULL,
  "transport_outcome" TEXT,
  "terminal_evidence" TEXT,
  "stable_error_code" TEXT,
  "reserved_input_tokens" INTEGER NOT NULL,
  "reserved_output_tokens" INTEGER NOT NULL,
  "settled_input_tokens" INTEGER,
  "settled_output_tokens" INTEGER,
  "input_tokens" INTEGER,
  "output_tokens" INTEGER,
  "cache_read_tokens" INTEGER,
  "cache_write_tokens" INTEGER,
  "acquired_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "owner_lease_expires_at" TIMESTAMP(3),
  "hard_call_deadline" TIMESTAMP(3),
  "heartbeat_at" TIMESTAMP(3),
  "provider_started_at" TIMESTAMP(3),
  "provider_finished_at" TIMESTAMP(3),
  "released_at" TIMESTAMP(3),
  "error" TEXT,
  CONSTRAINT "llm_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "llm_attempts_used_slot_no_check" CHECK ("used_slot_no" BETWEEN 1 AND 3),
  CONSTRAINT "llm_attempts_physical_attempt_index_check" CHECK ("physical_attempt_index" >= 0),
  CONSTRAINT "llm_attempts_genesis_task_id_fkey" FOREIGN KEY ("genesis_task_id") REFERENCES "genesis_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "llm_attempts_genesis_job_id_fkey" FOREIGN KEY ("genesis_job_id") REFERENCES "genesis_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "llm_slots" (
  "slot_no" INTEGER NOT NULL,
  "current_attempt_id" TEXT,
  "slot_epoch" INTEGER NOT NULL DEFAULT 0,
  "bound_at" TIMESTAMP(3),
  CONSTRAINT "llm_slots_pkey" PRIMARY KEY ("slot_no"),
  CONSTRAINT "llm_slots_slot_no_check" CHECK ("slot_no" BETWEEN 1 AND 3),
  CONSTRAINT "llm_slots_current_attempt_id_fkey" FOREIGN KEY ("current_attempt_id") REFERENCES "llm_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "llm_permit_requests" (
  "id" TEXT NOT NULL,
  "logical_call_id" TEXT NOT NULL,
  "physical_attempt_index" INTEGER NOT NULL,
  "user_id" TEXT NOT NULL,
  "task_class" TEXT NOT NULL,
  "priority" INTEGER NOT NULL,
  "endpoint_key" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "cache_isolation_domain" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT $$waiting$$,
  "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "acquired_at" TIMESTAMP(3),
  "cancelled_at" TIMESTAMP(3),
  CONSTRAINT "llm_permit_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "llm_fairness" (
  "user_id" TEXT NOT NULL,
  "virtual_finish" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "last_granted_at" TIMESTAMP(3),
  CONSTRAINT "llm_fairness_pkey" PRIMARY KEY ("user_id")
);

CREATE TABLE "llm_circuits" (
  "circuit_key" TEXT NOT NULL,
  "endpoint_key" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "task_class" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT $$closed$$,
  "failure_count" INTEGER NOT NULL DEFAULT 0,
  "open_until" TIMESTAMP(3),
  "probe_request_id" TEXT,
  "last_failure_code" TEXT,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "llm_circuits_pkey" PRIMARY KEY ("circuit_key")
);

CREATE UNIQUE INDEX "llm_attempts_logical_call_id_physical_attempt_index_key" ON "llm_attempts"("logical_call_id", "physical_attempt_index");
CREATE INDEX "llm_attempts_state_acquired_at_idx" ON "llm_attempts"("state", "acquired_at");
CREATE INDEX "llm_attempts_endpoint_key_model_task_class_state_idx" ON "llm_attempts"("endpoint_key", "model", "task_class", "state");
CREATE INDEX "llm_attempts_user_id_state_idx" ON "llm_attempts"("user_id", "state");
CREATE INDEX "llm_attempts_genesis_task_id_state_idx" ON "llm_attempts"("genesis_task_id", "state");
CREATE UNIQUE INDEX "llm_slots_current_attempt_id_key" ON "llm_slots"("current_attempt_id");
CREATE UNIQUE INDEX "llm_permit_requests_logical_call_id_physical_attempt_index_key" ON "llm_permit_requests"("logical_call_id", "physical_attempt_index");
CREATE INDEX "llm_permit_requests_state_priority_requested_at_idx" ON "llm_permit_requests"("state", "priority", "requested_at");
CREATE INDEX "llm_permit_requests_user_id_state_idx" ON "llm_permit_requests"("user_id", "state");
CREATE INDEX "llm_circuits_state_open_until_idx" ON "llm_circuits"("state", "open_until");

INSERT INTO "llm_slots" ("slot_no", "slot_epoch") VALUES (1, 0), (2, 0), (3, 0);
