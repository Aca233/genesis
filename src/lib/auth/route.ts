import type { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth/session";
import { unauthorizedJson } from "@/lib/auth/errors";

/**
 * 路由包装器:先过 requireUserId DAL,再把 userId 注入 handler。
 * UnauthorizedError 统一映射 401 {"error":"未登录或会话已过期"}(文案复用 errors.ts);
 * 非鉴权错误原样向上抛,交回路由既有 catch 处理。
 *
 * 消费端保持 Next 兼容导出:
 *   export const GET = withAuth(async (userId, _request, { params }: { params: Promise<{ id: string }> }) => {...});
 * 既有测试继续以 GET(request, ctx) 调用不变。
 */
export function withAuth<C>(handler: (userId: string, request: Request, context: C) => Promise<Response>) {
  return async (request: Request, context: C) => {
    let userId: string;
    try {
      userId = await requireUserId();
    } catch (e) {
      const mapped: NextResponse | null = unauthorizedJson(e); // UnauthorizedError → 401 {"error":"未登录或会话已过期"}
      if (mapped) return mapped;
      throw e;
    }
    return handler(userId, request, context);
  };
}
