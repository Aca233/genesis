export type SaveMaterialVersionState = {
  open: boolean;
  versionName: string;
  note: string;
  setDefault: boolean;
  pending: boolean;
  error: string | null;
};
export const initialSaveMaterialVersionState: SaveMaterialVersionState = {
  open: false, versionName: "", note: "", setDefault: false, pending: false, error: null,
};
export function openSaveMaterialDialog(_state: SaveMaterialVersionState, versionName = "") {
  return { ...initialSaveMaterialVersionState, open: true, versionName: versionName.trim() };
}
export function closeSaveMaterialDialog() {
  return initialSaveMaterialVersionState;
}
export function canSubmitMaterialVersion(state: SaveMaterialVersionState) {
  return state.open && !state.pending && state.versionName.trim().length > 0;
}
export function settleSaveMaterialVersion(state: SaveMaterialVersionState, error: string | null) {
  return error ? { ...state, open: true, pending: false, error } : initialSaveMaterialVersionState;
}
