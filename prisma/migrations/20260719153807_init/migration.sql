-- CreateTable
CREATE TABLE "worlds" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL DEFAULT 'local',
    "name" TEXT NOT NULL,
    "genesis_input" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "theme_card" JSONB,
    "style_card" JSONB,
    "cosmology" JSONB,
    "fusion_axiom" JSONB,
    "active_timeline_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "worlds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "timelines" (
    "id" TEXT NOT NULL,
    "world_id" TEXT NOT NULL,
    "parent_id" TEXT,
    "fork_chapter" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "timelines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chapters" (
    "id" TEXT NOT NULL,
    "timeline_id" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "title" TEXT,
    "summary" TEXT,
    "settle_state" TEXT NOT NULL DEFAULT 'open',
    "snapshot" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chapters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "chapter_id" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "scale" TEXT NOT NULL DEFAULT 'scene',
    "variants" JSONB,
    "meta" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gods" (
    "id" TEXT NOT NULL,
    "timeline_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "aliases" TEXT[],
    "tier" TEXT NOT NULL,
    "is_player" BOOLEAN NOT NULL DEFAULT false,
    "rank" TEXT NOT NULL DEFAULT 'nascent',
    "domains" TEXT[],
    "persona" JSONB,
    "voice" JSONB,
    "agenda" JSONB,
    "agenda_revealed" BOOLEAN NOT NULL DEFAULT false,
    "relations" JSONB,
    "faith_scope" TEXT,
    "codex_entity_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entities" (
    "id" TEXT NOT NULL,
    "timeline_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "aliases" TEXT[],
    "emblem_seed" TEXT NOT NULL,
    "image_url" TEXT,
    "starred" BOOLEAN NOT NULL DEFAULT false,
    "is_chosen" BOOLEAN NOT NULL DEFAULT false,
    "heat" TEXT NOT NULL DEFAULT 'active',
    "scene_presence" BOOLEAN NOT NULL DEFAULT false,
    "summary" TEXT NOT NULL,
    "locked_paths" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "entities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entity_sections" (
    "id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "revealed" BOOLEAN NOT NULL DEFAULT true,
    "rumor_text" TEXT,
    "player_locked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "entity_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chronicle_entries" (
    "id" TEXT NOT NULL,
    "timeline_id" TEXT NOT NULL,
    "chapter_index" INTEGER NOT NULL,
    "year_label" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "entity_ids" TEXT[],
    "god_ids" TEXT[],
    "revealed" BOOLEAN NOT NULL DEFAULT true,
    "revealed_at_chapter" INTEGER,
    "source" TEXT NOT NULL DEFAULT 'narrative',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chronicle_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "omen_queue" (
    "id" TEXT NOT NULL,
    "timeline_id" TEXT NOT NULL,
    "god_id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "consumed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "omen_queue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lorebook_entries" (
    "id" TEXT NOT NULL,
    "world_id" TEXT NOT NULL,
    "keys" TEXT[],
    "content" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "st_extra" JSONB,
    "source" TEXT NOT NULL DEFAULT 'imported',

    CONSTRAINT "lorebook_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "user_id" TEXT NOT NULL DEFAULT 'local',
    "narrative_slot" JSONB,
    "backstage_slot" JSONB,
    "embedding_slot" JSONB,
    "prefs" JSONB,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "llm_calls" (
    "id" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "slot" TEXT NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "llm_calls_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "worlds_user_id_idx" ON "worlds"("user_id");

-- CreateIndex
CREATE INDEX "timelines_world_id_idx" ON "timelines"("world_id");

-- CreateIndex
CREATE UNIQUE INDEX "chapters_timeline_id_index_key" ON "chapters"("timeline_id", "index");

-- CreateIndex
CREATE UNIQUE INDEX "messages_chapter_id_index_key" ON "messages"("chapter_id", "index");

-- CreateIndex
CREATE INDEX "gods_timeline_id_idx" ON "gods"("timeline_id");

-- CreateIndex
CREATE INDEX "entities_timeline_id_type_idx" ON "entities"("timeline_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "entity_sections_entity_id_key_key" ON "entity_sections"("entity_id", "key");

-- CreateIndex
CREATE INDEX "chronicle_entries_timeline_id_chapter_index_idx" ON "chronicle_entries"("timeline_id", "chapter_index");

-- CreateIndex
CREATE INDEX "omen_queue_timeline_id_consumed_idx" ON "omen_queue"("timeline_id", "consumed");

-- CreateIndex
CREATE INDEX "lorebook_entries_world_id_idx" ON "lorebook_entries"("world_id");

-- CreateIndex
CREATE INDEX "llm_calls_created_at_idx" ON "llm_calls"("created_at");

-- AddForeignKey
ALTER TABLE "timelines" ADD CONSTRAINT "timelines_world_id_fkey" FOREIGN KEY ("world_id") REFERENCES "worlds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_timeline_id_fkey" FOREIGN KEY ("timeline_id") REFERENCES "timelines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_chapter_id_fkey" FOREIGN KEY ("chapter_id") REFERENCES "chapters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gods" ADD CONSTRAINT "gods_timeline_id_fkey" FOREIGN KEY ("timeline_id") REFERENCES "timelines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entities" ADD CONSTRAINT "entities_timeline_id_fkey" FOREIGN KEY ("timeline_id") REFERENCES "timelines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_sections" ADD CONSTRAINT "entity_sections_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chronicle_entries" ADD CONSTRAINT "chronicle_entries_timeline_id_fkey" FOREIGN KEY ("timeline_id") REFERENCES "timelines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "omen_queue" ADD CONSTRAINT "omen_queue_timeline_id_fkey" FOREIGN KEY ("timeline_id") REFERENCES "timelines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lorebook_entries" ADD CONSTRAINT "lorebook_entries_world_id_fkey" FOREIGN KEY ("world_id") REFERENCES "worlds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
