import type { ExtractorChapterMessage } from "@/lib/prompts/extractor";

export const EXTRACTION_MAX_MESSAGES = 40;
export const EXTRACTION_MAX_MESSAGE_CHARS = 2_000;
export const EXTRACTION_MAX_TOTAL_CHARS = 40_000;
export const EXTRACTION_MAX_OUTPUT_TOKENS = 6_000;
export const EXTRACTION_MAX_ENTITIES = 80;
export const EXTRACTION_MAX_ABILITIES = 120;

export type ExtractionOwnerIndex = {
  id: string;
  name: string;
  aliases: string[];
  type: string;
  raceId: string | null;
};

const EXTRACTION_CHUNK_OVERLAP = 200;

function messageChunks<T extends ExtractorChapterMessage>(message: T): T[] {
  if (message.content.length <= EXTRACTION_MAX_MESSAGE_CHARS) return [{ ...message }];
  const chunks: T[] = [];
  const step = EXTRACTION_MAX_MESSAGE_CHARS - EXTRACTION_CHUNK_OVERLAP;
  for (let start = 0; start < message.content.length; start += step) {
    chunks.push({ ...message, content: message.content.slice(start, start + EXTRACTION_MAX_MESSAGE_CHARS) });
    if (start + EXTRACTION_MAX_MESSAGE_CHARS >= message.content.length) break;
  }
  return chunks;
}

/** Covers the entire chapter in bounded chronological windows without renumbering messages. */
export function extractionMessageWindows<T extends ExtractorChapterMessage>(messages: readonly T[]): T[][] {
  const chunks = messages.flatMap(messageChunks);
  const windows: T[][] = [];
  let window: T[] = [];
  let chars = 0;
  for (const chunk of chunks) {
    if (window.length > 0 && (window.length >= EXTRACTION_MAX_MESSAGES || chars + chunk.content.length > EXTRACTION_MAX_TOTAL_CHARS)) {
      windows.push(window);
      window = [];
      chars = 0;
    }
    window.push(chunk);
    chars += chunk.content.length;
  }
  if (window.length > 0) windows.push(window);
  return windows;
}

export function boundExtractionMessages<T extends ExtractorChapterMessage>(messages: readonly T[]): T[] {
  const newest = messages.slice(-EXTRACTION_MAX_MESSAGES);
  let remaining = EXTRACTION_MAX_TOTAL_CHARS;
  const reversed: T[] = [];
  for (let index = newest.length - 1; index >= 0 && remaining > 0; index -= 1) {
    const message = newest[index]!;
    const content = message.content.slice(-Math.min(EXTRACTION_MAX_MESSAGE_CHARS, remaining));
    reversed.push({ ...message, content });
    remaining -= content.length;
  }
  return reversed.reverse();
}

export function mentionedOwnerIds(
  messages: readonly ExtractorChapterMessage[],
  owners: readonly ExtractionOwnerIndex[],
): Set<string> {
  const text = messages.map((message) => message.content).join("\n");
  const ids = new Set<string>();
  for (const owner of owners) {
    if ([owner.name, ...owner.aliases].some((name) => name.length > 0 && text.includes(name))) {
      ids.add(owner.id);
      if (owner.type === "character" && owner.raceId) ids.add(owner.raceId);
    }
  }
  return ids;
}
