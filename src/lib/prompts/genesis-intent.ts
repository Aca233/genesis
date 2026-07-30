import type { WorldMode } from "@/lib/world-mode";
import { GenesisIntentContractSchema } from "@/lib/genesis/intent";
import { z } from "zod";

export type GenesisIntentPromptInput = {
  mode: WorldMode;
  decree: string;
  lorebookExcerpts?: string;
};

const intentJsonSchema = JSON.stringify(z.toJSONSchema(GenesisIntentContractSchema), null, 2);

export function genesisIntentSystem(mode: WorldMode): string {
  const playerRolePolicy = mode === "pantheon"
    ? "The player is one separate independent god with limited influence and must not replace the protagonist. Set playerRole.type to independent_god and mustNotReplaceProtagonist to true."
    : "The player is an external creator outside the world, never a world-internal protagonist or god. Set playerRole.type to external_creator and narrativeFunction to external_author.";

  return `You extract a binding intent contract for a world-generation pipeline.

Preserve exactly one narrative center. Treat explicit identity fusion or reincarnation in the user decree as the protagonist identity, not as permission to create duplicate protagonists, avatars, gods, assistants, technologies, factions, or completed future achievements.

${playerRolePolicy}

Keep sourceBasis and sourceIps cardinality exact: original requires exactly 0 sourceIps; single_ip requires exactly 1 sourceIps; multi_ip requires 2 to 6 sourceIps.

Separate facts true at the declared opening anchor from future-only possibilities. Put speculative technologies, relationships, discoveries, institutions, powers, and achievements in futureOnly, never factsAtAnchor. Record prohibited extrapolations in forbiddenExpansions and uncertain cross-IP mechanics in fusionBoundaries.

Use uncertaintyPolicy exactly as omit_or_generalize. When source evidence is missing, omit the claim or generalize it; never invent canon details. Preserve every explicit premise from the decree while keeping sourceIps bounded to named source works.

Return only JSON matching this schema:
${intentJsonSchema}`;
}

export function genesisIntentUserPrompt(input: GenesisIntentPromptInput): string {
  const sections = [
    `Extract the genesis intent contract for mode="${input.mode}".`,
    `User decree:\n${input.decree}`,
  ];

  if (input.lorebookExcerpts !== undefined && input.lorebookExcerpts.trim().length > 0) {
    sections.push(`Player-provided lorebook excerpts:\n${input.lorebookExcerpts}`);
  }

  sections.push("Return only the intent contract JSON. Do not generate the world deck.");
  return sections.join("\n\n");
}
