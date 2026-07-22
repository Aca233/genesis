import { beforeEach, describe, expect, it, vi } from "vitest";
import { completeDeck } from "@/lib/abilities/embark.test-fixtures";
import { CreatorWorldDeckSchema, PantheonWorldDeckSchema } from "@/lib/cards/schemas";

const mocks = vi.hoisted(() => ({
  completeStructured: vi.fn(),
  create: vi.fn(),
}));

vi.mock("@/lib/llm/structured", () => ({
  completeStructured: mocks.completeStructured,
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    world: {
      create: mocks.create,
      findMany: vi.fn(),
    },
  },
}));

import { POST } from "./route";

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

function request() {
  return new Request("http://localhost/api/worlds", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ decree: "创造星海神域" }),
  });
}

describe("POST /api/worlds legacy pantheon entry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.create.mockResolvedValue({ id: "world-1" });
  });

  it("拒绝 creator 模型输出且绝不持久化", async () => {
    const creator = creatorDeck();
    mocks.completeStructured.mockImplementation(async (
      _slot: unknown,
      options: { schema: { parse(value: unknown): unknown } },
    ) => options.schema.parse(creator));

    const response = await POST(request());

    expect(response.status).toBe(502);
    expect(mocks.completeStructured).toHaveBeenCalledWith(
      "narrative",
      expect.objectContaining({ schema: PantheonWorldDeckSchema }),
    );
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
});
