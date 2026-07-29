export type ProseLintRuleId =
  | "markdown_heading"
  | "code_fence"
  | "repeated_punctuation"
  | "stock_phrase"
  | "repeated_paragraph_opening";

export type ProseLintFinding = {
  ruleId: ProseLintRuleId;
  severity: "info" | "warning";
  start: number;
  end: number;
  evidence: string;
};

const MAX_FINDINGS = 50;
const STOCK_PHRASES = [
  "空气仿佛凝固",
  "眼中闪过",
  "嘴角勾起",
  "一丝",
  "一抹",
  "一缕",
] as const;

function collectMatches(
  prose: string,
  pattern: RegExp,
  ruleId: ProseLintRuleId,
  severity: ProseLintFinding["severity"],
): ProseLintFinding[] {
  return [...prose.matchAll(pattern)].map((match) => ({
    ruleId,
    severity,
    start: match.index,
    end: match.index + match[0].length,
    evidence: match[0],
  }));
}

function repeatedParagraphOpenings(prose: string): ProseLintFinding[] {
  const findings: ProseLintFinding[] = [];
  const seen = new Set<string>();
  const pattern = /(?:^|\n\s*\n)([^\n]+)/g;
  for (const match of prose.matchAll(pattern)) {
    const paragraph = match[1].trim();
    if (paragraph.length < 8 || paragraph.startsWith("#") || paragraph.startsWith("```")) continue;
    const opening = paragraph.replace(/^[“”’"（(\s]+/u, "").slice(0, 4);
    if (opening.length < 4) continue;
    if (seen.has(opening)) {
      const paragraphOffset = match[0].lastIndexOf(match[1]);
      const start = match.index + paragraphOffset + match[1].indexOf(paragraph);
      findings.push({
        ruleId: "repeated_paragraph_opening",
        severity: "info",
        start,
        end: start + opening.length,
        evidence: opening,
      });
    } else {
      seen.add(opening);
    }
  }
  return findings;
}

export function lintNarrativeProse(prose: string): ProseLintFinding[] {
  const findings = [
    ...collectMatches(prose, /^#{1,6}\s+.+$/gm, "markdown_heading", "warning"),
    ...collectMatches(prose, /```/g, "code_fence", "warning"),
    ...collectMatches(prose, /[！!？?]{2,}/g, "repeated_punctuation", "warning"),
    ...STOCK_PHRASES.flatMap((phrase) => collectMatches(
      prose,
      new RegExp(phrase, "g"),
      "stock_phrase",
      "info",
    )),
    ...repeatedParagraphOpenings(prose),
  ];

  return findings
    .sort((left, right) => left.start - right.start || left.ruleId.localeCompare(right.ruleId))
    .slice(0, MAX_FINDINGS);
}
