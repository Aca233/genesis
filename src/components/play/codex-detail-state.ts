import type { AbilityEventView } from "./types";

export type CodexDetailLoadState<Detail, Chronicle> = {
  detail: Detail | null;
  chronicle: Chronicle[];
  abilityHistory: Record<string, AbilityEventView[]>;
  error: string | null;
  loading: boolean;
};

export function emptyCodexDetailState<Detail, Chronicle>(): CodexDetailLoadState<
  Detail,
  Chronicle
> {
  return {
    detail: null,
    chronicle: [],
    abilityHistory: {},
    error: null,
    loading: true,
  };
}

export function beginCodexDetailLoad<Detail, Chronicle>(
  previous: CodexDetailLoadState<Detail, Chronicle>,
): CodexDetailLoadState<Detail, Chronicle> {
  void previous;
  return emptyCodexDetailState<Detail, Chronicle>();
}

export function groupAbilityEvents(
  events: readonly AbilityEventView[],
): Record<string, AbilityEventView[]> {
  const grouped: Record<string, AbilityEventView[]> = {};
  for (const event of events) {
    (grouped[event.abilityId] ??= []).push(event);
  }
  return grouped;
}

export function completeCodexDetailLoad<Detail, Chronicle>(
  _previous: CodexDetailLoadState<Detail, Chronicle>,
  detail: Detail,
  chronicle: Chronicle[],
  abilityEvents: readonly AbilityEventView[],
): CodexDetailLoadState<Detail, Chronicle> {
  return {
    detail,
    chronicle,
    abilityHistory: groupAbilityEvents(abilityEvents),
    error: null,
    loading: false,
  };
}

export function failCodexDetailLoad<Detail, Chronicle>(
  message: string,
): CodexDetailLoadState<Detail, Chronicle> {
  return {
    detail: null,
    chronicle: [],
    abilityHistory: {},
    error: message,
    loading: false,
  };
}
