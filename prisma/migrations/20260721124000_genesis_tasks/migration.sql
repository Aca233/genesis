-- CreateTable
CREATE TABLE "genesis_tasks" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL DEFAULT 'local',
    "decree" TEXT NOT NULL,
    "lorebook" JSONB,
    "lorebook_name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "stage" TEXT NOT NULL DEFAULT 'oracle',
    "completed_keys" TEXT[] NOT NULL,
    "raw_output" TEXT NOT NULL DEFAULT '',
    "error" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "lease_token" TEXT,
    "lease_expires_at" TIMESTAMP(3),
    "world_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "genesis_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "genesis_tasks_world_id_key" ON "genesis_tasks"("world_id");
CREATE INDEX "genesis_tasks_user_id_status_idx" ON "genesis_tasks"("user_id", "status");
CREATE INDEX "genesis_tasks_status_lease_expires_at_idx" ON "genesis_tasks"("status", "lease_expires_at");

-- AddForeignKey
ALTER TABLE "genesis_tasks" ADD CONSTRAINT "genesis_tasks_world_id_fkey" FOREIGN KEY ("world_id") REFERENCES "worlds"("id") ON DELETE SET NULL ON UPDATE CASCADE;
