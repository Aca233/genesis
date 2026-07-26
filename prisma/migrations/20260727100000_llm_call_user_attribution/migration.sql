-- LlmCall 归因列（多租户 Phase A，a0-gateway-llmcall）。
-- 历史行保持 NULL，不回填；仅加列与索引，零 ALTER 其他表。
ALTER TABLE "llm_calls" ADD COLUMN IF NOT EXISTS "user_id" TEXT;
ALTER TABLE "llm_calls" ADD COLUMN IF NOT EXISTS "world_id" TEXT;

CREATE INDEX IF NOT EXISTS "llm_calls_user_id_created_at_idx" ON "llm_calls"("user_id", "created_at");
