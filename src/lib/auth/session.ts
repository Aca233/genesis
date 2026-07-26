/**
 * DAL 会话模块 —— A2 测试契约(全仓路由测试统一遵守)
 *
 * 本模块**只导出 requireUserId 一个符号**;UnauthorizedError / unauthorizedJson
 * 在 ./errors.ts(纯模块,测试**永不** mock 它),因此路由测试 mock 本模块
 * 恰好一行即可,无需还原任何错误类:
 *
 * ```ts
 * vi.mock("@/lib/auth/session", () => ({
 *   requireUserId: vi.fn().mockResolvedValue("test-user"),
 * }));
 * ```
 *
 * 约定:
 * 1. 该行放在既有 `vi.mock("@/lib/db", ...)` 旁;随后把测试内字面量 "local"
 *    机械替换为 "test-user"(mb7 提供 TEST_USER_ID 常量后统一改为 import)。
 * 2. 需要断言 401 分支的测试:把 requireUserId 的 mock 挂到 vi.hoisted 的
 *    mocks 对象上(同 src/app/api/worlds/route.test.ts 的 vi.hoisted 模式),
 *    用例内 `import { UnauthorizedError } from "@/lib/auth/errors"` 后
 *    `mocks.requireUserId.mockRejectedValue(new UnauthorizedError())`
 *    ——errors.ts 未被 mock,路由 catch 里的 instanceof 判定成立。
 * 3. 不得为绕过鉴权而弱化任何既有行为断言。
 */
import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { auth } from "./index";
import { UnauthorizedError } from "./errors";

/** DAL:同一请求内 React cache() 去重;无会话抛 UnauthorizedError(路由层用 unauthorizedJson 映射 401) */
export const requireUserId = cache(async (): Promise<string> => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new UnauthorizedError();
  return session.user.id;
});
