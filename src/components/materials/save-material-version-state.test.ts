import { describe, expect, it } from "vitest";
import { canSubmitMaterialVersion, closeSaveMaterialDialog, initialSaveMaterialVersionState, openSaveMaterialDialog, settleSaveMaterialVersion } from "./save-material-version-state";

describe("save material version state", () => {
  it("requires a version name and prevents duplicate pending submits", () => {
    const open = openSaveMaterialDialog(initialSaveMaterialVersionState, " 第七章后 ");
    expect(open.open).toBe(true);
    expect(canSubmitMaterialVersion({ ...open, versionName: "" })).toBe(false);
    expect(canSubmitMaterialVersion({ ...open, pending: true })).toBe(false);
    expect(canSubmitMaterialVersion(open)).toBe(true);
  });
  it("closes and clears successful forms but keeps failed input", () => {
    const state = { ...openSaveMaterialDialog(initialSaveMaterialVersionState), versionName: "剧情版", note: "保留", setDefault: true, pending: true };
    expect(settleSaveMaterialVersion(state, null)).toEqual(initialSaveMaterialVersionState);
    expect(settleSaveMaterialVersion(state, "网络错误")).toMatchObject({ open: true, pending: false, versionName: "剧情版", note: "保留", setDefault: true, error: "网络错误" });
    expect(closeSaveMaterialDialog()).toEqual(initialSaveMaterialVersionState);
  });
});
