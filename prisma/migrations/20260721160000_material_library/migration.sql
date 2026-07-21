ALTER TABLE "worlds"
  ADD COLUMN "material_archive_status" TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN "material_archive_error" TEXT;
ALTER TABLE "genesis_tasks" ADD COLUMN "material_selection" JSONB;
ALTER TABLE "gods" ADD COLUMN "material_ref" TEXT;
ALTER TABLE "entities" ADD COLUMN "material_ref" TEXT;
ALTER TABLE "abilities" ADD COLUMN "material_ref" TEXT;

CREATE TABLE "material_cards" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL DEFAULT 'local',
  "kind" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "favorite" BOOLEAN NOT NULL DEFAULT false,
  "hidden" BOOLEAN NOT NULL DEFAULT false,
  "source_world_id" TEXT,
  "source_world_name" TEXT NOT NULL,
  "source_kind" TEXT NOT NULL,
  "source_ref" TEXT NOT NULL,
  "default_version_id" TEXT,
  "last_used_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "material_cards_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "material_versions" (
  "id" TEXT NOT NULL,
  "card_id" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "note" TEXT,
  "content" JSONB NOT NULL,
  "dependencies" JSONB NOT NULL,
  "schema_version" INTEGER NOT NULL DEFAULT 1,
  "is_initial" BOOLEAN NOT NULL DEFAULT false,
  "parent_version_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "material_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "material_cards_user_id_source_kind_source_ref_key" ON "material_cards"("user_id", "source_kind", "source_ref");
CREATE INDEX "material_cards_user_id_favorite_hidden_updated_at_idx" ON "material_cards"("user_id", "favorite", "hidden", "updated_at");
CREATE INDEX "material_cards_source_world_id_idx" ON "material_cards"("source_world_id");
CREATE UNIQUE INDEX "material_versions_card_id_version_key" ON "material_versions"("card_id", "version");
CREATE INDEX "material_versions_parent_version_id_idx" ON "material_versions"("parent_version_id");
CREATE UNIQUE INDEX "gods_timeline_id_material_ref_key" ON "gods"("timeline_id", "material_ref");
CREATE UNIQUE INDEX "entities_timeline_id_material_ref_key" ON "entities"("timeline_id", "material_ref");
CREATE UNIQUE INDEX "abilities_timeline_id_material_ref_key" ON "abilities"("timeline_id", "material_ref");

ALTER TABLE "material_cards" ADD CONSTRAINT "material_cards_source_world_id_fkey" FOREIGN KEY ("source_world_id") REFERENCES "worlds"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "material_versions" ADD CONSTRAINT "material_versions_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "material_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "material_versions" ADD CONSTRAINT "material_versions_parent_version_id_fkey" FOREIGN KEY ("parent_version_id") REFERENCES "material_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "material_cards" ADD CONSTRAINT "material_cards_default_version_id_fkey" FOREIGN KEY ("default_version_id") REFERENCES "material_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
