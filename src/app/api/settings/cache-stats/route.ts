import { NextResponse } from "next/server";
import { loadPromptCacheStats } from "@/lib/llm/cache-stats";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await loadPromptCacheStats());
  } catch {
    return NextResponse.json({ error: "缓存统计读取失败" }, { status: 500 });
  }
}
