import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(
  resolve(process.cwd(), "src/app/page.tsx"),
  "utf8",
);
const globalCss = readFileSync(
  resolve(process.cwd(), "src/app/globals.css"),
  "utf8",
);

describe("genesis mode background homepage contract", () => {
  it("passes the existing worldMode state into the visual layer", () => {
    expect(pageSource).toContain(
      'import { GenesisModeBackground } from "@/components/genesis/GenesisModeBackground";',
    );
    expect(pageSource).toContain(
      "<GenesisModeBackground mode={worldMode} />",
    );
  });

  it("defines crossfade, mobile attenuation, and reduced-motion fallback", () => {
    expect(globalCss).toContain(".genesis-mode-background__image");
    expect(globalCss).toContain(
      ".genesis-mode-background__image.is-active",
    );
    expect(globalCss).toContain("transition: opacity 600ms ease;");
    expect(globalCss).toContain("@media (max-width: 640px)");
    expect(globalCss).toContain(
      "@media (prefers-reduced-motion: reduce)",
    );
  });
});
