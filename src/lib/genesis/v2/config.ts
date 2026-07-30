export function isGenesisV2ShadowEnabled(
  value = process.env.GENESIS_V2_SHADOW_ENABLED,
): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}
