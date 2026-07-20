-- CreateTable
CREATE TABLE "generation_requests" (
    "id" TEXT NOT NULL,
    "chapter_id" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "scale" TEXT NOT NULL,
    "content" TEXT,
    "directive" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "player_message_id" TEXT,
    "narrator_message_id" TEXT NOT NULL,
    "player_index" INTEGER,
    "narrator_index" INTEGER NOT NULL,
    "result_meta" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "generation_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "generation_requests_chapter_id_status_idx" ON "generation_requests"("chapter_id", "status");

-- AddForeignKey
ALTER TABLE "generation_requests" ADD CONSTRAINT "generation_requests_chapter_id_fkey" FOREIGN KEY ("chapter_id") REFERENCES "chapters"("id") ON DELETE CASCADE ON UPDATE CASCADE;
