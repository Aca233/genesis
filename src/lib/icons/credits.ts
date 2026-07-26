import { ICON_CATALOG_BY_TOKEN } from "./catalog";
import { resolveIcon } from "./resolver";
import type { AttributionRecord, IconFamily, WorldIconTheme } from "./types";

export type IconCredit = {
  id: string;
  family: IconFamily;
  license: string;
  attribution?: AttributionRecord;
};

type AssignmentSubjectType = "entity" | "god" | "ability" | "event";

export function collectIconCredits(input: {
  theme: WorldIconTheme;
  assignments: Array<{
    subjectType: AssignmentSubjectType;
    subjectId: string;
    token: string;
  }>;
}): IconCredit[] {
  const requests = [
    ...Object.entries(input.theme.assignments.navigation).map(([role, token]) => ({
      subjectType: "entity" as const,
      subjectId: `navigation:${role}`,
      token,
    })),
    ...input.assignments,
  ];
  const byId = new Map<string, IconCredit>();
  for (const request of requests) {
    if (!ICON_CATALOG_BY_TOKEN.has(request.token)) continue;
    const resolved = resolveIcon({ theme: input.theme, ...request });
    byId.set(resolved.id, {
      id: resolved.id,
      family: resolved.family,
      license: resolved.license,
      ...(resolved.attribution ? { attribution: resolved.attribution } : {}),
    });
  }
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}

export function renderIconCreditsMarkdown(credits: readonly IconCredit[]): string {
  const lines = ["# Icon Credits", "", "This world uses the following locally bundled icons:", ""];
  for (const credit of credits) {
    if (credit.attribution) {
      lines.push(
        `- **${credit.id}** — ${credit.attribution.collection}; ${credit.attribution.icon}; `
          + `${credit.attribution.author}; [${credit.attribution.license}](${credit.attribution.licenseUrl}); `
          + `[source](${credit.attribution.sourceUrl})`,
      );
    } else {
      lines.push(`- **${credit.id}** — ${credit.license}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
