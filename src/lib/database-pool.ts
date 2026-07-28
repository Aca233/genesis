const DEFAULT_DATABASE_POOL_MAX = 5;

export function databasePoolMax(raw: string | undefined): number {
  const value = raw?.trim();
  if (!value) return DEFAULT_DATABASE_POOL_MAX;
  if (!/^\d+$/.test(value)) {
    throw new Error("DATABASE_POOL_MAX 必须是 1 到 50 的整数");
  }
  const parsed = Number(value);
  if (parsed < 1 || parsed > 50) {
    throw new Error("DATABASE_POOL_MAX 必须是 1 到 50 的整数");
  }
  return parsed;
}
