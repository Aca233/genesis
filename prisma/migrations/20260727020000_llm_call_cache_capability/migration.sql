-- 落库端点缓存能力降级快照（F8 可观测）。
-- 该列在部分环境已被手工加入 llm_calls，故使用 IF NOT EXISTS 保证幂等。
ALTER TABLE "llm_calls" ADD COLUMN IF NOT EXISTS "cache_capability" TEXT;
