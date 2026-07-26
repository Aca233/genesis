-- 《创世》月度观测数据清理:删除 90 天前的 LlmCall 记录
-- 表:llm_calls(prisma/schema.prisma @@map,created_at 有索引)
-- cron(genesis 用户,每月 1 日):
--   20 4 1 * * psql "<不带 query 参数的 DATABASE_URL>" -f /srv/genesis/bin/cleanup-llmcalls.sql
--
-- 注意:llm_calls 是可再生的观测数据,是唯一做定期清理的表;
-- 任何承载用户创作的表(worlds/timelines/messages 等)不做清理。

\timing on

DELETE FROM llm_calls
WHERE created_at < now() - interval '90 days';

-- 回收死元组并刷新统计信息(表小,2C2G 上开销可忽略)
VACUUM (ANALYZE) llm_calls;
