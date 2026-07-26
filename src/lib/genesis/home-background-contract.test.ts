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

function extractCssBlock(source: string, header: RegExp): string {
  const match = header.exec(source);
  if (!match) {
    throw new Error(`Missing CSS block matching ${header}`);
  }

  const openingBrace = source.indexOf("{", match.index);
  let depth = 0;

  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === "{") {
      depth += 1;
    } else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(openingBrace + 1, index);
      }
    }
  }

  throw new Error(`Unclosed CSS block matching ${header}`);
}

function readDeclaration(block: string, property: string): string {
  const escapedProperty = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const uncommentedBlock = block.replace(/\/\*[\s\S]*?\*\//g, "");
  const matches = [...uncommentedBlock.matchAll(
    new RegExp(
      `(?:^|;)\\s*${escapedProperty}\\s*:\\s*([^;]+)\\s*;`,
      "gs",
    ),
  )];
  const match = matches.at(-1);

  if (!match) {
    throw new Error(`Missing CSS declaration ${property}`);
  }

  return match[1].trim().replace(/\s+/g, " ");
}

describe("genesis mode background homepage contract", () => {
  it("mounts the mode layer immediately after the existing home background", () => {
    expect(pageSource).toMatch(
      /import\s*\{\s*GenesisModeBackground\s*\}\s*from\s*["']@\/components\/genesis\/GenesisModeBackground["']\s*;/,
    );
    expect(pageSource).toMatch(
      /<PlayBackground\s+variant\s*=\s*["']home["']\s*\/>\s*<GenesisModeBackground\s+mode\s*=\s*\{\s*worldMode\s*\}\s*\/>/,
    );
  });

  it("keeps the universal day and candle images while defining both mode themes", () => {
    const dayTheme = extractCssBlock(globalCss, /:root\s*\{/);
    const candleTheme = extractCssBlock(
      globalCss,
      /\[data-theme\s*=\s*["']candle["']\s*\]\s*\{/,
    );

    expect(readDeclaration(dayTheme, "--play-background-image")).toMatch(
      /^url\(\s*["']?\/images\/backgrounds\/play-celestial-day\.webp["']?\s*\)$/,
    );
    expect(readDeclaration(dayTheme, "--genesis-mode-opacity")).toBe("0.38");
    expect(readDeclaration(dayTheme, "--genesis-mode-filter")).toBe(
      "saturate(1.12) sepia(0.06) brightness(1.02) contrast(1.08)",
    );
    expect(readDeclaration(dayTheme, "--genesis-mode-blend")).toBe("normal");

    expect(readDeclaration(candleTheme, "--play-background-image")).toMatch(
      /^url\(\s*["']?\/images\/backgrounds\/play-celestial-candle\.webp["']?\s*\)$/,
    );
    expect(readDeclaration(candleTheme, "--genesis-mode-opacity")).toBe("0.34");
    expect(readDeclaration(candleTheme, "--genesis-mode-filter")).toBe(
      "saturate(0.86) sepia(0.16) brightness(0.86) contrast(1.04)",
    );
    expect(readDeclaration(candleTheme, "--genesis-mode-blend")).toBe("screen");
  });

  it("crossfades only opacity, protects the center, and keeps the panel translucent", () => {
    const imageLayer = extractCssBlock(
      globalCss,
      /\.genesis-mode-background__image\s*\{/,
    );
    const activeLayer = extractCssBlock(
      globalCss,
      /\.genesis-mode-background__image\.is-active\s*\{/,
    );
    const protectionMask = extractCssBlock(
      globalCss,
      /\.genesis-mode-background::after\s*\{/,
    );
    const homePanel = extractCssBlock(
      globalCss,
      /\.home-genesis-panel\s*\{/,
    );

    expect(readDeclaration(imageLayer, "transition")).toBe(
      "opacity 600ms ease",
    );
    expect(readDeclaration(activeLayer, "opacity")).toBe(
      "var(--genesis-mode-opacity)",
    );
    expect(readDeclaration(protectionMask, "content")).toBe('""');
    expect(readDeclaration(protectionMask, "position")).toBe("absolute");
    expect(readDeclaration(protectionMask, "inset")).toBe("0");
    expect(readDeclaration(protectionMask, "background")).toMatch(
      /radial-gradient\(.*var\(--paper\)/,
    );
    expect(readDeclaration(homePanel, "background")).toMatch(
      /^color-mix\(\s*in srgb,\s*var\(--paper\)\s+84%,\s*transparent\s*\)$/,
    );
  });

  it("attenuates and repositions the mode layer on mobile", () => {
    const mobileRules = extractCssBlock(
      globalCss,
      /@media\s*\(\s*max-width\s*:\s*640px\s*\)\s*\{/,
    );
    const mobileImageLayer = extractCssBlock(
      mobileRules,
      /\.genesis-mode-background__image\s*\{/,
    );
    const mobileActiveLayer = extractCssBlock(
      mobileRules,
      /\.genesis-mode-background__image\.is-active\s*\{/,
    );

    expect(readDeclaration(mobileImageLayer, "object-position")).toMatch(
      /^center\s+34%$/,
    );
    expect(readDeclaration(mobileActiveLayer, "opacity")).toMatch(
      /^calc\(\s*var\(--genesis-mode-opacity\)\s*\*\s*0\.72\s*\)$/,
    );
  });

  it("disables the mode crossfade when reduced motion is requested", () => {
    const reducedMotionRules = extractCssBlock(
      globalCss,
      /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*\{/,
    );
    const reducedMotionImageLayer = extractCssBlock(
      reducedMotionRules,
      /\.genesis-mode-background__image\s*\{/,
    );

    expect(readDeclaration(reducedMotionImageLayer, "transition")).toBe("none");
  });
});
