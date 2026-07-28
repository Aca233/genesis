ALTER TABLE worlds
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id TEXT NOT NULL,
  actor_user_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  target_label TEXT NOT NULL,
  reason TEXT NOT NULL,
  success BOOLEAN NOT NULL,
  request_ip TEXT,
  metadata JSONB,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT admin_audit_logs_pkey PRIMARY KEY (id),
  CONSTRAINT admin_audit_logs_actor_user_id_fkey
    FOREIGN KEY (actor_user_id) REFERENCES "user"(id)
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS admin_audit_logs_created_at_idx
  ON admin_audit_logs(created_at);
CREATE INDEX IF NOT EXISTS admin_audit_logs_actor_user_id_created_at_idx
  ON admin_audit_logs(actor_user_id, created_at);
CREATE INDEX IF NOT EXISTS admin_audit_logs_target_type_target_id_created_at_idx
  ON admin_audit_logs(target_type, target_id, created_at);
