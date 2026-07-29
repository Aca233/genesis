import { beforeEach, describe, expect, it, vi } from "vitest";
import { completeDeck } from "@/lib/abilities/embark.test-fixtures";

const mocks = vi.hoisted(() => ({
  complete: vi.fn(),
  candidate: vi.fn(),
  acceptedCount: vi.fn(),
  jobUpdateMany: vi.fn(),
  claimedJob: vi.fn(),
  dependencyFindMany: vi.fn(),
  artifactFindFirst: vi.fn(),
  ownedJob: vi.fn(),
  artifactUpdateMany: vi.fn(),
  artifactCreate: vi.fn(),
  jobUpdate: vi.fn(),
  taskUpdate: vi.fn(),
  taskUpdateMany: vi.fn(),
}));

const tx = {
  genesisJob: {
    findUnique: mocks.candidate,
    findUniqueOrThrow: mocks.claimedJob,
    findFirst: mocks.ownedJob,
    updateMany: mocks.jobUpdateMany,
    update: mocks.jobUpdate,
  },
  genesisArtifact: {
    count: mocks.acceptedCount,
    updateMany: mocks.artifactUpdateMany,
    create: mocks.artifactCreate,
  },
  genesisTask: { update: mocks.taskUpdate },
};

vi.mock("@/lib/db", () => ({ prisma: {
  $transaction: vi.fn((callback) => callback(tx)),
  genesisArtifact: {
    findMany: mocks.dependencyFindMany,
    findFirst: mocks.artifactFindFirst,
  },
  genesisJob: { updateMany: mocks.jobUpdateMany },
  genesisTask: { updateMany: mocks.taskUpdateMany },
} }));
vi.mock("@/lib/llm/structured", () => ({ completeStructured: mocks.complete }));

import { runGenesisShadowJob } from "./shadow-runner";

const preflight = {
  preflightHash: "preflight-hash",
  structuralManifest: {
    schemaVersion: 1,
    mode: "pantheon",
    counts: {},
    manifestHash: "manifest-hash",
    slots: [],
  },
  sourceObligationManifest: { obligations: [] },
  budgetPlan: {
    stages: [{ stage: "blueprint", maxOutputTokens: 4000 }],
  },
};

const deck = completeDeck();
const blueprintOutput = {
  mode: deck.mode,
  worldName: deck.worldName,
  cosmology: deck.cosmology,
  fusionAxiom: deck.fusionAxiom,
  style: deck.style,
  theme: deck.theme,
  canonBrief: "潮汐统治星辰",
  slotBriefs: {},
};
const pantheonOutput = {
  mode: deck.mode,
  playerGod: deck.playerGod,
  majorGods: deck.majorGods,
  minorGods: deck.minorGods,
};
const civilizationsOutput = {
  mode: deck.mode,
  races: deck.races,
  factions: deck.factions,
  places: deck.places,
};
const erasOutput = {
  mode: deck.mode,
  epochConflict: deck.epochConflict,
};
const charactersOutput = {
  mode: deck.mode,
  majorCharacters: deck.majorCharacters,
};

describe("Genesis V2 shadow runner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.candidate.mockResolvedValue({
      id: "job-blueprint",
      genesisTaskId: "task-1",
      nodeKey: "shadow:blueprint",
      task: {
        status: "completed",
        shadowEnabled: true,
      },
    });
    mocks.acceptedCount.mockResolvedValue(0);
    mocks.jobUpdateMany.mockResolvedValue({ count: 1 });
    mocks.claimedJob.mockResolvedValue({
      id: "job-blueprint",
      genesisTaskId: "task-1",
      nodeKey: "shadow:blueprint",
      leaseToken: "lease-1",
      leaseEpoch: 2,
      leaseExpiresAt: new Date("2026-07-28T12:01:00.000Z"),
      attempt: 1,
      inputHash: "preflight-hash",
      task: {
        userId: "user-1",
        mode: "pantheon",
        decree: "创造潮汐星海",
        shadowPreflight: preflight,
        shadowPreflightHash: "preflight-hash",
      },
    });
    mocks.dependencyFindMany.mockResolvedValue([]);
    mocks.artifactFindFirst.mockResolvedValue(null);
    mocks.ownedJob.mockResolvedValue({ id: "job-blueprint" });
    mocks.complete.mockResolvedValue(blueprintOutput);
    mocks.artifactUpdateMany.mockResolvedValue({ count: 0 });
    mocks.artifactCreate.mockResolvedValue({});
    mocks.jobUpdate.mockResolvedValue({});
    mocks.taskUpdate.mockResolvedValue({});
  });

  it("只写 shadow Artifact，并以独立预算和最低优先级调用模型", async () => {
    await runGenesisShadowJob("job-blueprint");

    expect(mocks.complete).toHaveBeenCalledWith("backstage", expect.objectContaining({
      task: "world-director-probe",
      maxAttempts: 1,
      transportMaxAttempts: 1,
      allowTransportFallback: false,
      owner: expect.objectContaining({
        genesisTaskId: "task-1",
        genesisJobId: "job-blueprint",
        budgetScope: "shadow",
      }),
    }));
    const request = mocks.complete.mock.calls[0]![1];
    expect(request.schema.safeParse({
      ...blueprintOutput,
      majorCharacters: deck.majorCharacters,
    }).success).toBe(false);
    expect(mocks.artifactCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      stageKey: "blueprint",
      status: "accepted",
      visibility: "shadow",
    }) });
    expect(mocks.jobUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "completed" }),
    }));
    expect("world" in tx).toBe(false);
  });

  it("legacy 尚未完成时不领取也不调用模型", async () => {
    mocks.candidate.mockResolvedValue({
      id: "job-blueprint",
      genesisTaskId: "task-1",
      nodeKey: "shadow:blueprint",
      task: { status: "running", shadowEnabled: true },
    });

    await runGenesisShadowJob("job-blueprint");

    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.artifactCreate).not.toHaveBeenCalled();
  });

  it("人物阶段完成后确定性组装并封存 playable_core Artifact", async () => {
    const characterEntitySlots = deck.majorCharacters.map((character, index) => ({
      slotId: `character-${index + 1}`,
      category: "entity",
      kind: "character",
      order: index,
      canonicalRef: character.ref,
      ownerSlotId: null,
      role: null,
      binding: "generated",
      materialVersionId: null,
      sourceRef: null,
    }));
    const characterAbilitySlots = deck.majorCharacters.flatMap((character, characterIndex) =>
      character.abilities.map((ability, abilityIndex) => ({
        slotId: `character-ability-${characterIndex + 1}-${abilityIndex + 1}`,
        category: "ability",
        kind: "ability",
        order: characterEntitySlots.length + characterIndex * 2 + abilityIndex,
        canonicalRef: ability.ref,
        ownerSlotId: characterEntitySlots[characterIndex]!.slotId,
        role: "identity",
        binding: "generated",
        materialVersionId: null,
        sourceRef: null,
      })),
    );
    const characterPreflight = {
      ...preflight,
      structuralManifest: {
        ...preflight.structuralManifest,
        slots: [...characterEntitySlots, ...characterAbilitySlots],
      },
    };
    mocks.candidate.mockResolvedValue({
      id: "job-characters",
      genesisTaskId: "task-1",
      nodeKey: "shadow:characters",
      task: { status: "completed", shadowEnabled: true },
    });
    mocks.acceptedCount.mockResolvedValue(3);
    mocks.claimedJob.mockResolvedValue({
      id: "job-characters",
      genesisTaskId: "task-1",
      nodeKey: "shadow:characters",
      leaseToken: "lease-characters",
      leaseEpoch: 2,
      leaseExpiresAt: new Date("2026-07-28T12:01:00.000Z"),
      attempt: 1,
      inputHash: "preflight-hash",
      task: {
        userId: "user-1",
        mode: "pantheon",
        decree: "创造潮汐星海",
        shadowPreflight: characterPreflight,
        shadowPreflightHash: "preflight-hash",
      },
    });
    mocks.dependencyFindMany.mockResolvedValue([
      { stageKey: "civilizations", outputHash: "hash-civilizations", content: civilizationsOutput },
      { stageKey: "eras", outputHash: "hash-eras", content: erasOutput },
      { stageKey: "pantheon_domain", outputHash: "hash-pantheon", content: pantheonOutput },
    ]);
    mocks.artifactFindFirst.mockResolvedValue({
      outputHash: "hash-blueprint",
      content: blueprintOutput,
    });
    mocks.complete.mockResolvedValue(charactersOutput);

    await runGenesisShadowJob("job-characters");

    expect(mocks.artifactCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      stageKey: "playable_core",
      status: "sealed",
      visibility: "shadow",
      content: deck,
    }) });
    expect(mocks.taskUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: { shadowStatus: "completed" },
    }));
  });
});
