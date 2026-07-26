-- CreateTable
CREATE TABLE "lore_index_entries" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL DEFAULT 'local',
    "source_key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "keywords" TEXT[],
    "category" TEXT NOT NULL,
    "temporal_hints" JSONB NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 50,
    "excerpt" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lore_index_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lore_index_entries_user_id_category_idx" ON "lore_index_entries"("user_id", "category");

-- CreateIndex
CREATE UNIQUE INDEX "lore_index_entries_user_id_source_key_key" ON "lore_index_entries"("user_id", "source_key");
