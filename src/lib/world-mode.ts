import { z } from "zod";

export const WORLD_MODES = ["pantheon", "creator"] as const;
export const WorldModeSchema = z.enum(WORLD_MODES);
export type WorldMode = z.infer<typeof WorldModeSchema>;

export const WORLD_MODE_PRESENTATION: Record<WorldMode, {
  label: string;
  description: string;
  subtitle: string;
  placeholder: string;
  validationNoun: string;
}> = {
  pantheon: {
    label: "诸神共世",
    description: "玩家是神谱中的一员，拥有玩家神卡、位阶与神权，受世界法则、能力边界和迷雾约束。",
    subtitle: "说出你的第一句神谕——你是谁，这是怎样的世界。",
    placeholder: "我是谁？我是战锤40K与凡人修仙传融合世界中，飞升失败坠入亚空间的道尊……",
    validationNoun: "神谕",
  },
  creator: {
    label: "创世主",
    description: "立于世界之外，观看一个自行运转的宇宙，并以绝对敕令改写现实。",
    subtitle: "描述你要创造的世界——众生与诸神将在其中自行运转。",
    placeholder: "一个群星熄灭、古神从黑暗中苏醒的宇宙，凡人文明正争夺最后的恒星火种……",
    validationNoun: "世界描述",
  },
};

export function worldModeLabel(mode: WorldMode): string {
  return WORLD_MODE_PRESENTATION[mode].label;
}

export function assertModeTransition(current: WorldMode, next: WorldMode): void {
  if (current !== next) throw new Error("世界模式不可更改");
}
