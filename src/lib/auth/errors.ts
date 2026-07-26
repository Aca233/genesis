import { NextResponse } from "next/server";

/** 会话缺失/过期 —— 由 requireUserId 抛出,路由层统一映射 401 */
export class UnauthorizedError extends Error {
  constructor() {
    super("未登录或会话已过期");
    this.name = "UnauthorizedError";
  }
}

/** 路由 catch 分支统一 401 映射:非鉴权错误返回 null 交回原有处理 */
export function unauthorizedJson(error: unknown): NextResponse | null {
  if (error instanceof UnauthorizedError) {
    return NextResponse.json({ error: "未登录或会话已过期" }, { status: 401 });
  }
  return null;
}
