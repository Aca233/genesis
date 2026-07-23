-- CreateTable
CREATE TABLE "world_events" (
    "id" TEXT NOT NULL,
    "timeline_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "visibility" TEXT NOT NULL,
    "participant_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "origin_message_id" TEXT NOT NULL,
    "origin_activity_id" TEXT,
    "latest_message_id" TEXT NOT NULL,
    "parent_event_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "world_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "world_activities" (
    "id" TEXT NOT NULL,
    "timeline_id" TEXT NOT NULL,
    "event_id" TEXT,
    "record_type" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "visibility" TEXT NOT NULL,
    "actor_id" TEXT,
    "target_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "subject_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "source_message_id" TEXT NOT NULL,
    "era_label" TEXT NOT NULL,
    "time_label" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "world_activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "world_events_timeline_id_phase_updated_at_idx"
    ON "world_events"("timeline_id", "phase", "updated_at");

-- CreateIndex
CREATE INDEX "world_activities_timeline_id_created_at_idx"
    ON "world_activities"("timeline_id", "created_at");

-- CreateIndex
CREATE INDEX "world_activities_event_id_created_at_idx"
    ON "world_activities"("event_id", "created_at");

-- AddForeignKey
ALTER TABLE "world_events"
    ADD CONSTRAINT "world_events_timeline_id_fkey"
    FOREIGN KEY ("timeline_id") REFERENCES "timelines"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "world_events"
    ADD CONSTRAINT "world_events_parent_event_id_fkey"
    FOREIGN KEY ("parent_event_id") REFERENCES "world_events"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "world_activities"
    ADD CONSTRAINT "world_activities_timeline_id_fkey"
    FOREIGN KEY ("timeline_id") REFERENCES "timelines"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "world_activities"
    ADD CONSTRAINT "world_activities_event_id_fkey"
    FOREIGN KEY ("event_id") REFERENCES "world_events"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
