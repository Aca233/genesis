import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const editorPage = new URL("../../app/genesis/[worldId]/page.tsx", import.meta.url);

describe("Creator genesis embark UI", () => {
  it("enables the shared embark action and ceremony for Creator decks", async () => {
    const source = await readFile(editorPage, "utf8");

    expect(source).not.toContain("开局待启");
    expect(source).not.toContain('title={deck.mode === "creator"');
    expect(source).not.toContain('disabled={deck.mode === "creator"');
    expect(source).not.toContain('deck.mode === "pantheon" && ceremony');
    expect(source).toContain('{ceremony && ceremony.phase !== "error" && (');
  });
});
