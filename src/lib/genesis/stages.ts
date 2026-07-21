import {
  GENESIS_TOP_LEVEL_KEYS,
  type GenesisTopLevelKey,
} from "./json-progress";

export const GENESIS_STAGES = [
  { id: "oracle", title: "聆听神谕", description: "请求建立，解析随行典籍" },
  { id: "laws", title: "奠定世界法则", description: "凝聚世界名、宇宙论与融合公理" },
  { id: "gods", title: "铸造诸神", description: "塑造玩家神与诸神谱系" },
  { id: "peoples", title: "铺展众生与疆域", description: "生成种族、势力与重要地点" },
  { id: "characters", title: "编织命运人物", description: "创造推动时代的主要人物" },
  { id: "conflict", title: "确立时代冲突", description: "定下时代矛盾、文风与主题" },
  { id: "validation", title: "校验世界引用", description: "核验卡组结构及所有稳定引用" },
  { id: "repair", title: "修补命运裂隙", description: "定向修复不完整结构或错误引用" },
  { id: "saving", title: "世界凝固成形", description: "保存可编辑的世界草稿" },
  { id: "completed", title: "创世完成", description: "前往卡组典籍继续雕琢世界" },
] as const;

export type GenesisStageId = (typeof GENESIS_STAGES)[number]["id"];
export type GenesisTaskStatus = "queued" | "running" | "repairing" | "completed" | "failed";

const requirements: Array<{ stage: GenesisStageId; keys: GenesisTopLevelKey[] }> = [
  { stage: "laws", keys: ["worldName", "cosmology", "fusionAxiom"] },
  { stage: "gods", keys: ["playerGod", "majorGods", "minorGods"] },
  { stage: "peoples", keys: ["races", "factions", "places"] },
  { stage: "characters", keys: ["majorCharacters"] },
  { stage: "conflict", keys: ["epochConflict", "style", "theme"] },
];

export function mergeCompletedKeys(
  previous: readonly string[],
  incoming: readonly GenesisTopLevelKey[],
): GenesisTopLevelKey[] {
  const all = new Set<string>([...previous, ...incoming]);
  return GENESIS_TOP_LEVEL_KEYS.filter((key) => all.has(key));
}

/** Returns the phase currently being generated, never a synthetic percentage. */
export function deriveStreamingStage(completedKeys: readonly string[]): GenesisStageId {
  const completed = new Set(completedKeys);
  for (const group of requirements) {
    if (!group.keys.every((key) => completed.has(key))) return group.stage;
  }
  // Validation begins only after the model stream itself has ended.
  return "conflict";
}


export function furthestStage(
  previous: GenesisStageId,
  incoming: GenesisStageId,
): GenesisStageId {
  const previousIndex = GENESIS_STAGES.findIndex(({ id }) => id === previous);
  const incomingIndex = GENESIS_STAGES.findIndex(({ id }) => id === incoming);
  return incomingIndex > previousIndex ? incoming : previous;
}

export function completedStageIndex(stage: GenesisStageId, status: GenesisTaskStatus): number {
  if (status === "completed") return GENESIS_STAGES.length;
  const index = GENESIS_STAGES.findIndex((candidate) => candidate.id === stage);
  return Math.max(0, index);
}

export function isGenesisStageId(value: string): value is GenesisStageId {
  return GENESIS_STAGES.some((stage) => stage.id === value);
}
