-- Reconcile schema changes that were generated into Prisma Client but were
-- missing from the migration history. Keep additive changes idempotent because
-- some development databases received them manually.

ALTER TABLE llm_calls
  ADD COLUMN IF NOT EXISTS agent_call_index INTEGER,
  ADD COLUMN IF NOT EXISTS agent_run_id TEXT,
  ADD COLUMN IF NOT EXISTS cache_layer TEXT,
  ADD COLUMN IF NOT EXISTS dynamic_tokens INTEGER,
  ADD COLUMN IF NOT EXISTS stable_prefix_hash TEXT,
  ADD COLUMN IF NOT EXISTS tool_result_tokens INTEGER;

ALTER TABLE omen_queue
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'omen';

CREATE TABLE IF NOT EXISTS canon_events (
  id TEXT NOT NULL,
  timeline_id TEXT NOT NULL,
  ref TEXT NOT NULL,
  title TEXT NOT NULL,
  time_label TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  epoch TEXT NOT NULL DEFAULT 'future',
  summary TEXT NOT NULL,
  participant_refs TEXT[],
  prerequisites JSONB NOT NULL,
  blockers JSONB,
  expected_consequences JSONB,
  status TEXT NOT NULL DEFAULT 'pending',
  visibility TEXT NOT NULL DEFAULT 'author_only',
  divergence_note TEXT,
  occurred_chapter_index INTEGER,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL,

  CONSTRAINT canon_events_pkey PRIMARY KEY (id),
  CONSTRAINT canon_events_timeline_id_fkey
    FOREIGN KEY (timeline_id) REFERENCES timelines(id)
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS canon_events_timeline_id_status_idx
  ON canon_events(timeline_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS canon_events_timeline_id_ref_key
  ON canon_events(timeline_id, ref);
CREATE UNIQUE INDEX IF NOT EXISTS canon_events_timeline_id_ordinal_key
  ON canon_events(timeline_id, ordinal);
CREATE INDEX IF NOT EXISTS llm_calls_stable_prefix_hash_idx
  ON llm_calls(stable_prefix_hash);
CREATE INDEX IF NOT EXISTS llm_calls_agent_run_id_idx
  ON llm_calls(agent_run_id);
