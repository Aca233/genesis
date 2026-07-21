export type MaterialContentField = {
  label: string;
  value: string;
};

export type MaterialContentItem = {
  title: string;
  subtitle?: string;
  fields: MaterialContentField[];
};

export type MaterialContentSection = {
  title: string;
  text?: string;
  values?: string[];
  fields?: MaterialContentField[];
  items?: MaterialContentItem[];
  private?: boolean;
};

export type MaterialContentView = {
  title: string | null;
  origin: string | null;
  sections: MaterialContentSection[];
};

type JsonRecord = Record<string, unknown>;

const LABELS: Record<string, string> = {
  name: "名称",
  title: "标题",
  aliases: "别名与称号",
  summary: "简介",
  type: "类型",
  identity: "身份",
  ageStage: "年龄阶段",
  race: "种族",
  raceRef: "主种族",
  factionMemberships: "势力归属",
  role: "身份职务",
  isPrimary: "主要归属",
  personality: "性格",
  goals: "目标",
  situation: "当前处境",
  divineTies: "与诸神的关系",
  conflictTies: "与时代冲突的关系",
  learnedTraditionRefs: "已习得传统",
  racialOverrides: "血脉能力",
  abilities: "能力",
  origin: "世界起源",
  powerSystem: "力量体系",
  laws: "世界法则",
  divinity: "神性法则",
  sourceIps: "融合来源",
  axioms: "融合公理",
  powerMapping: "力量对标",
  conflictRule: "冲突裁定",
  domains: "领域",
  rank: "位阶",
  persona: "性情与形象",
  voice: "言语风格",
  verbalTics: "语癖",
  address: "称呼习惯",
  catchphrases: "口头禅",
  neverSays: "绝不会说",
  agenda: "幕后议程",
  longTermGoal: "长期目标",
  shortTermGoals: "近期目标",
  methods: "行事方式",
  stanceToPlayer: "对玩家态度",
  level: "立场",
  motive: "动机",
  schemes: "正在谋划",
  initialRelationToPlayer: "与玩家的初始关系",
  label: "关系",
  note: "说明",
  faithScope: "信仰范围",
  faithBase: "信仰根基",
  kind: "类别",
  overview: "概况",
  territory: "疆域",
  faith: "信仰",
  keyFigures: "关键人物",
  keyCharacterRefs: "关键人物",
  traits: "族群特征",
  lifespan: "寿命",
  distribution: "分布",
  allegiance: "归属",
  epochName: "纪元名称",
  yearLabel: "当前纪年",
  overtConflicts: "公开冲突",
  hiddenCurrents: "时代暗流",
  preset: "文风预设",
  presetName: "文风名称",
  toneNotes: "文风细则",
  eraSystem: "纪年体系",
  rankNames: "位阶称谓",
  typeNames: "实体称谓",
  addressStyle: "称谓风格",
  effect: "效果",
  trigger: "发动条件",
  cost: "代价",
  limitations: "限制与克制",
  mastery: "掌握程度",
  state: "当前状态",
  visibility: "可见性",
  rumorText: "传闻",
  bloodlineJustification: "血脉依据",
  sections: "详细档案",
  memberships: "势力归属",
  members: "成员",
  relations: "关系",
  starred: "重点关注",
  isChosen: "天选者",
  isMajorCharacter: "主要人物",
  heat: "活跃度",
  scenePresence: "当前登场",
  content: "内容",
  agendaRevealed: "议程已揭示",
  tier: "神格层级",
  isPlayer: "玩家神",
  customLore: "补充设定",
  secretSeeds: "秘密线索",
  appearance: "外貌",
  scale: "叙事尺度",
  stance: "立场",
  relatedType: "相关类型",
  owner: "拥有者",
  sourceAbility: "来源能力",
};

const VALUE_LABELS: Record<string, string> = {
  true: "是",
  false: "否",
  player: "玩家神",
  major: "主神",
  minor: "次要神",
  fallen: "陨灭",
  ember: "余烬",
  slumbering: "沉睡",
  nascent: "微末",
  ascended: "成神",
  exalted: "显赫",
  sovereign: "主宰",
  lesser: "次位",
  greater: "高位",
  supreme: "至高",
  personal: "个人能力",
  divine: "神权",
  racial_innate: "种族天赋",
  racial_tradition: "族群传统",
  unawakened: "尚未觉醒",
  novice: "初识",
  adept: "熟练",
  expert: "精通",
  master: "大师",
  normal: "正常",
  enhanced: "强化",
  impaired: "受损",
  weakened: "衰弱",
  sealed: "封印",
  lost: "失去",
  deprecated: "废弃",
  known: "公开",
  rumored: "传闻",
  hidden: "隐藏",
  enemy: "敌对",
  rival: "竞争",
  neutral: "中立",
  ally: "盟友",
  vassal: "隶属",
  unknown: "未知",
  hostility: "敌意",
  rivalry: "竞争",
  cooperation: "合作",
  dependence: "依附",
  moment: "瞬息",
  scene: "场景",
  years: "数载",
  era: "年代",
  epoch: "纪元",
  faction: "势力",
  character: "人物",
  race: "种族",
  place: "地点",
  artifact: "器物",
  cult: "教派",
  god: "神明",
  ability: "能力",
  player_god: "玩家神",
  major_god: "主神",
  cosmology: "宇宙论",
  fusion_axiom: "融合公理",
  epoch_conflict: "时代冲突",
  style: "文风",
  theme: "主题",
  epic: "史诗",
  webnovel: "网文",
  grimdark: "黑暗残酷",
  lightnovel: "轻小说",
  canon: "原典风格",
};

const INTERNAL_KEYS = new Set([
  "id",
  "ref",
  "sourceRef",
  "sourceAbilityRef",
  "factionRef",
  "materialRef",
  "schemaVersion",
  "lockedFields",
  "lockedPaths",
  "internalId",
  "imageUrl",
  "emblemSeed",
  "createdAt",
  "updatedAt",
  "version",
  "events",
]);

const PRIVATE_KEYS = new Set([
  "agenda",
  "schemes",
  "hiddenCurrents",
  "secretSeeds",
  "rumorText",
]);

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInternalKey(key: string) {
  return INTERNAL_KEYS.has(key) || /(?:Id|Ids|Ref|Refs)$/.test(key);
}

function labelFor(key: string, fallback?: string) {
  return fallback || LABELS[key] || "补充信息";
}

function scalarText(value: string | number | boolean) {
  const raw = String(value);
  return VALUE_LABELS[raw] ?? raw;
}

function readableValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return scalarText(value);
  }
  if (Array.isArray(value)) {
    return value.map(readableValue).filter(Boolean).join("；");
  }
  if (isRecord(value)) {
    return Object.entries(value)
      .filter(([key, nested]) => !isInternalKey(key) && nested !== null && nested !== "")
      .map(([key, nested]) => `${labelFor(key)}：${readableValue(nested)}`)
      .filter((entry) => !entry.endsWith("："))
      .join("；");
  }
  return String(value);
}

function recordFields(record: JsonRecord, excluded = new Set<string>()): MaterialContentField[] {
  return Object.entries(record)
    .filter(([key, value]) => !isInternalKey(key) && !excluded.has(key) && value !== null && value !== "")
    .map(([key, value]) => ({ label: labelFor(key), value: readableValue(value) }))
    .filter((field) => field.value.length > 0);
}

function objectItems(values: JsonRecord[], sectionKey: string): MaterialContentItem[] {
  return values.map((value, index) => {
    const title = readableValue(value.name ?? value.title ?? value.label) || `${labelFor(sectionKey)} ${index + 1}`;
    const subtitle = readableValue(value.kind ?? value.type ?? value.role);
    const fields = recordFields(value, new Set(["name", "title", "label", "kind", "type"]));
    return { title, ...(subtitle ? { subtitle } : {}), fields };
  });
}

function runtimeSections(value: unknown): MaterialContentSection[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).flatMap((section) => {
    const text = readableValue(section.content ?? section.text ?? section.value);
    if (!text) return [];
    const key = typeof section.key === "string" ? section.key : "section";
    return [{
      title: labelFor(key, typeof section.title === "string" ? section.title : undefined),
      text,
      private: section.visibility === "hidden" || PRIVATE_KEYS.has(key),
    }];
  });
}

function sectionFor(key: string, value: unknown): MaterialContentSection | null {
  if (isInternalKey(key) || key === "name" || value === null || value === "") return null;
  const title = labelFor(key);
  const privateSection = PRIVATE_KEYS.has(key);

  if (Array.isArray(value)) {
    const visible = value.filter((entry) => entry !== null && entry !== "");
    if (visible.length === 0) return null;
    if (visible.every(isRecord)) {
      return { title, items: objectItems(visible, key), private: privateSection };
    }
    return { title, values: visible.map(readableValue).filter(Boolean), private: privateSection };
  }

  if (isRecord(value)) {
    const fields = recordFields(value);
    return fields.length > 0 ? { title, fields, private: privateSection } : null;
  }

  const text = readableValue(value);
  return text ? { title, text, private: privateSection } : null;
}

export function buildMaterialContentView(content: unknown): MaterialContentView {
  if (!isRecord(content)) return { title: null, origin: null, sections: [] };
  const card = isRecord(content.card) ? content.card : content;
  const title = typeof card.name === "string" ? card.name : null;
  const origin = typeof content.origin === "string"
    ? ({ deck: "创世初始档案", runtime: "世界运行时快照", edited: "手动编辑版本" }[content.origin] ?? content.origin)
    : null;
  const sections: MaterialContentSection[] = [];

  for (const [key, value] of Object.entries(card)) {
    if (key === "sections") {
      sections.push(...runtimeSections(value));
      continue;
    }
    const section = sectionFor(key, value);
    if (section) sections.push(section);
  }

  return { title, origin, sections };
}
