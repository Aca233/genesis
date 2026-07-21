import type { MaterialSelectionItem } from "@/lib/materials/types";
import { detectMaterialConflicts, estimateMaterialBudget, type SelectedMaterial } from "@/lib/materials/selection";

export function upsertSelection(items: MaterialSelectionItem[], item: MaterialSelectionItem) {
  return [...items.filter((current) => current.materialCardId !== item.materialCardId), item]
    .sort((a, b) => a.priority - b.priority);
}
export function removeSelection(items: MaterialSelectionItem[], cardId: string) {
  return items.filter((item) => item.materialCardId !== cardId).map((item, priority) => ({ ...item, priority }));
}
export function inspectPickerSelection(items: SelectedMaterial[]) {
  const conflicts = detectMaterialConflicts(items);
  const budget = estimateMaterialBudget(items);
  return {
    conflicts,
    budget,
    blockingMessages: [
      ...conflicts.filter((conflict) => conflict.severity === "blocking").map((conflict) => conflict.message),
      ...(budget.overLimit ? [`素材输入约 ${budget.estimatedChars.toLocaleString()} 字符，超过 ${(120_000).toLocaleString()} 字符上限`] : []),
    ],
  };
}
