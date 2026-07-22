import { beforeEach, describe, expect, it, vi } from "vitest";
import { completeDeck } from "@/lib/abilities/embark.test-fixtures";
import { CreatorWorldDeckSchema, PantheonWorldDeckSchema } from "@/lib/cards/schemas";

const mocks = vi.hoisted(() => ({
  completeStructured: vi.fn(),
  create: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock("@/lib/llm/structured", () => ({
  completeStructured: mocks.completeStructured,
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    world: {
      create: mocks.create,
      findMany: mocks.findMany,
    },
  },
}));

import { GET, POST } from "./route";

function creatorDeck() {
  const { playerGod: _playerGod, ...shared } = completeDeck();
  void _playerGod;
  return CreatorWorldDeckSchema.parse({
    ...shared,
    mode: "creator",
    majorGods: shared.majorGods.map(({
      agenda,
      initialRelationToPlayer: _initialRelationToPlayer,
      ...god
    }, index, gods) => {
      void _initialRelationToPlayer;
      return {
        ...god,
        agenda: {
          longTermGoal: agenda.longTermGoal,
          shortTermGoals: agenda.shortTermGoals,
          methods: agenda.methods,
          schemes: agenda.schemes,
        },
        relations: [{
          targetGodRef: gods[(index + 1) % gods.length]!.ref,
          label: "rival",
          note: "世界内诸神竞争",
        }],
      };
    }),
  });
}

function request(mode?: "pantheon" | "creator") {
  return new Request("http://localhost/api/worlds", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decree: "创造星海神域", ...(mode ? { mode } : {}) }),
  });
}

describe("/api/worlds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.create.mockResolvedValue({ id: "world-1" });
  });

  it("creator 请求使用精确 schema、prompt 并持久化相同模式", async () => {
    const creator = creatorDeck();
    mocks.completeStructured.mockResolvedValue(creator);

    const response = await POST(request("creator"));

    expect(response.status).toBe(200);
    expect(mocks.completeStructured).toHaveBeenCalledWith(
      "narrative",
      expect.objectContaining({
        schema: CreatorWorldDeckSchema,
        system: expect.stringContaining('mode="creator"'),
        user: expect.stringContaining('mode="creator"'),
      }),
    );
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ mode: "creator" }),
    }));
  });

  it("拒绝生成结果与请求模式不一致且绝不持久化", async () => {
    const creator = creatorDeck();
    mocks.completeStructured.mockImplementation(async (
      _slot: unknown,
      options: { schema: { parse(value: unknown): unknown } },
    ) => options.schema.parse(creator));

    const response = await POST(request("pantheon"));

    expect(response.status).toBe(502);
    expect(mocks.completeStructured).toHaveBeenCalledWith(
      "narrative",
      expect.objectContaining({ schema: PantheonWorldDeckSchema }),
    );
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("拒绝未知世界模式", async () => {
    const response = await POST(new Request("http://localhost/api/worlds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decree: "创造星海神域", mode: "absolute" }),
    }));

    expect(response.status).toBe(400);
    expect(mocks.completeStructured).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("成功创建时显式持久化 pantheon 模式", async () => {
    mocks.completeStructured.mockResolvedValue(completeDeck());

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ mode: "pantheon" }),
    }));
  });

  it("GET 存档列表显式查询 mode", async () => {
    mocks.findMany.mockResolvedValue([]);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({ mode: true }),
    }));
  });
});
