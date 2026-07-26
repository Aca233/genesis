import { describe, expect, it, vi } from "vitest";
import { UnauthorizedError } from "./errors";

const mocks = vi.hoisted(() => ({
  worldFindFirst: vi.fn(),
  timelineFindFirst: vi.fn(),
  chapterFindFirst: vi.fn(),
  messageFindFirst: vi.fn(),
  entityFindFirst: vi.fn(),
  abilityFindFirst: vi.fn(),
  godFindFirst: vi.fn(),
  materialCardFindFirst: vi.fn(),
  requireUserId: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    world: { findFirst: mocks.worldFindFirst },
    timeline: { findFirst: mocks.timelineFindFirst },
    chapter: { findFirst: mocks.chapterFindFirst },
    message: { findFirst: mocks.messageFindFirst },
    entity: { findFirst: mocks.entityFindFirst },
    ability: { findFirst: mocks.abilityFindFirst },
    god: { findFirst: mocks.godFindFirst },
    materialCard: { findFirst: mocks.materialCardFindFirst },
  },
}));

// errors.ts 是纯模块永不 mock —— withAuth 的 instanceof 判定必须走真实实现。
vi.mock("@/lib/auth/session", () => ({
  requireUserId: mocks.requireUserId,
}));

import {
  ownedWhere,
  requireWorld,
  requireTimeline,
  requireChapter,
  requireMessage,
  requireEntity,
  requireAbility,
  requireGod,
  requireMaterialCard,
} from "./ownership";
import { withAuth } from "./route";

const U = "user-1";
const ID = "row-1";

/** 8 种行走形状:精确 where 对象 + 对应门禁与 mock。 */
const cases = [
  {
    name: "world",
    gate: requireWorld,
    findFirst: mocks.worldFindFirst,
    where: { id: ID, userId: U },
  },
  {
    name: "timeline",
    gate: requireTimeline,
    findFirst: mocks.timelineFindFirst,
    where: { id: ID, world: { userId: U } },
  },
  {
    name: "chapter",
    gate: requireChapter,
    findFirst: mocks.chapterFindFirst,
    where: { id: ID, timeline: { world: { userId: U } } },
  },
  {
    name: "message",
    gate: requireMessage,
    findFirst: mocks.messageFindFirst,
    where: { id: ID, chapter: { timeline: { world: { userId: U } } } },
  },
  {
    name: "entity",
    gate: requireEntity,
    findFirst: mocks.entityFindFirst,
    where: { id: ID, timeline: { world: { userId: U } } },
  },
  {
    name: "ability",
    gate: requireAbility,
    findFirst: mocks.abilityFindFirst,
    where: { id: ID, timeline: { world: { userId: U } } },
  },
  {
    name: "god",
    gate: requireGod,
    findFirst: mocks.godFindFirst,
    where: { id: ID, timeline: { world: { userId: U } } },
  },
  {
    name: "materialCard",
    gate: requireMaterialCard,
    findFirst: mocks.materialCardFindFirst,
    where: { id: ID, userId: U },
  },
] as const;

describe("ownedWhere", () => {
  it.each(cases)("$name 行走形状精确匹配", ({ name, where }) => {
    expect(ownedWhere[name](U, ID)).toEqual(where);
  });
});

describe("require* 门禁", () => {
  it.each(cases)("$name:以精确 where + select {id} 查询并返回行", async ({ gate, findFirst, where }) => {
    findFirst.mockResolvedValue({ id: ID });
    await expect(gate(U, ID)).resolves.toEqual({ id: ID });
    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(findFirst).toHaveBeenCalledWith({ where, select: { id: true } });
  });

  it.each(cases)("$name:未命中时 null 透传", async ({ gate, findFirst }) => {
    findFirst.mockResolvedValue(null);
    await expect(gate(U, ID)).resolves.toBeNull();
  });
});

describe("withAuth", () => {
  const request = new Request("http://localhost/api/test");
  const context = { params: Promise.resolve({ id: "w1" }) };

  it("handler 收到 userId 与原始 request/context,响应原样透传", async () => {
    mocks.requireUserId.mockResolvedValue("test-user");
    // 零参函数可赋给 handler 形参类型;vi.fn 仍记录实际调用实参。
    const handler = vi.fn(async () => new Response("ok"));
    const wrapped = withAuth<typeof context>(handler);
    const res = await wrapped(request, context);
    expect(handler).toHaveBeenCalledWith("test-user", request, context);
    await expect(res.text()).resolves.toBe("ok");
  });

  it("UnauthorizedError → 401 JSON { error: \"未登录或会话已过期\" },handler 不执行", async () => {
    mocks.requireUserId.mockRejectedValue(new UnauthorizedError());
    const handler = vi.fn(async () => new Response("ok"));
    const wrapped = withAuth<typeof context>(handler);
    const res = await wrapped(request, context);
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "未登录或会话已过期" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("非鉴权错误向上抛", async () => {
    const boom = new Error("db down");
    mocks.requireUserId.mockRejectedValue(boom);
    const wrapped = withAuth<typeof context>(vi.fn(async () => new Response("ok")));
    await expect(wrapped(request, context)).rejects.toBe(boom);
  });
});
