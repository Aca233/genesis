import { NextResponse } from "next/server";
import { loadPromptCacheStats } from "@/lib/llm/cache-stats";
import { withAuth } from "@/lib/auth/route";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (userId) => {
  try {
    return NextResponse.json(await loadPromptCacheStats(userId));
  } catch {
    return NextResponse.json({ error: "缓存统计读取失败" }, { status: 500 });
  }
});
