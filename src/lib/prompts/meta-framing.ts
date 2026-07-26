export const META_START_LINE = "<<<META";
export const META_END_LINE = "META>>>";

export type MetaTailFrame = {
  start: number;
  body: string;
};

/**
 * Recognizes a complete META block only at the output tail.
 * The preferred protocol uses three lines. Some providers occasionally collapse
 * the same frame to `<<<META {...} META>>>`; accept that drift only when the
 * marker starts its own line and the body begins with a JSON object.
 */
export function findMetaTailFrame(full: string): MetaTailFrame | null {
  const match = full.match(
    /(?:^|\r?\n)<<<META\r?\n([\s\S]*?)\r?\nMETA>>>[ \t]*(?:\r?\n)*$/,
  );
  if (match?.index !== undefined) return { start: match.index, body: match[1] };

  const inline = full.match(
    /(?:^|\r?\n)<<<META[ \t]+(\{[\s\S]*\})[ \t]+META>>>[ \t]*(?:\r?\n)*$/,
  );
  if (!inline || inline.index === undefined) return null;
  return { start: inline.index, body: inline[1] };
}

/** Finds a possible standalone start line in a streaming suffix. */
export function findMetaStartCandidate(text: string): number {
  const match = /(?:^|\r?\n)<<<META(?=\r?\n|\s*\{|$)/.exec(text);
  return match?.index ?? -1;
}
