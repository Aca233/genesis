-- 时间一致设计稿 §10.4：报告型 AI 语义审计结果落任务行（加法、可空，旧行不受影响）
-- AlterTable
ALTER TABLE "genesis_tasks" ADD COLUMN "audit_report" JSONB;
