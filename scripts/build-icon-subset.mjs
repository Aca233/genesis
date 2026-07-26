#!/usr/bin/env node
/**
 * 构建期图标子集提取脚本(pnpm build:icons)。
 *
 * 背景:src/lib/icons/svg.server.ts 此前静态引入四个完整的 @iconify-json
 * 集合(合计约 14MB JSON),导致每个引用它的 API 路由包都在启动时急切
 * 解析全量图标数据。本脚本读取 src/lib/icons/catalog.ts 的全部
 * token -> 图标 id 映射(含 resolver.ts 的兜底 id),只把实际会用到的
 * 图标抽取到 src/lib/icons/icon-subset.generated.json(提交入库的产物,
 * 远小于 1MB),运行时仅加载该子集。
 *
 * catalog.ts 变更后必须重新运行本脚本并提交新产物;若忘记,svg.server.ts
 * 会在开发期回退加载完整集合并 console.warn 提示重新生成。
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import { getIconData } from "@iconify/utils";
import { icons as phosphorIcons } from "@iconify-json/ph";
import { icons as tablerIcons } from "@iconify-json/tabler";
import { icons as iconParkIcons } from "@iconify-json/icon-park-outline";
import { icons as gameIcons } from "@iconify-json/game-icons";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG_PATH = join(ROOT, "src", "lib", "icons", "catalog.ts");
const OUTPUT_PATH = join(ROOT, "src", "lib", "icons", "icon-subset.generated.json");
const CACHE_DIR = join(ROOT, "node_modules", ".cache", "genesis-icon-subset");
/** 子集产物的体积上限;超出说明目录膨胀失控,应当先审视 catalog.ts。 */
const MAX_OUTPUT_BYTES = 1024 * 1024;

/** resolver.ts 在 token 完全无法解析时兜底返回的图标 id,必须始终可用。 */
const RESOLVER_FALLBACK_IDS = ["ph:question"];

const FULL_COLLECTIONS = {
  ph: phosphorIcons,
  tabler: tablerIcons,
  "icon-park-outline": iconParkIcons,
  "game-icons": gameIcons,
};

/**
 * 把 catalog.ts 就地转译成临时 ESM 模块后导入,避免用正则去猜生成式
 * 条目(motif.* 由模板拼接,静态扫描无法穷举)。catalog.ts 仅有
 * `import type`(转译时整体擦除),因此转译产物不含任何运行时依赖。
 */
async function importCatalog() {
  const source = readFileSync(CATALOG_PATH, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: "catalog.ts",
  });
  mkdirSync(CACHE_DIR, { recursive: true });
  const compiledPath = join(CACHE_DIR, "catalog.compiled.mjs");
  writeFileSync(compiledPath, transpiled.outputText, "utf8");
  try {
    return await import(pathToFileURL(compiledPath).href);
  } finally {
    rmSync(compiledPath, { force: true });
  }
}

function collectIconIds(catalog) {
  const ids = new Set(RESOLVER_FALLBACK_IDS);
  for (const entry of catalog) {
    for (const id of Object.values(entry.families)) ids.add(id);
  }
  return [...ids].sort();
}

async function main() {
  const { ICON_CATALOG } = await importCatalog();
  if (!Array.isArray(ICON_CATALOG) || ICON_CATALOG.length === 0) {
    throw new Error("catalog.ts 未导出非空 ICON_CATALOG,转译或结构可能已变化");
  }

  const ids = collectIconIds(ICON_CATALOG);
  const namesByPrefix = new Map();
  const invalid = [];
  for (const id of ids) {
    const match = /^([a-z0-9-]+):([a-z0-9-]+)$/.exec(id);
    const prefix = match?.[1];
    if (!match || !(prefix in FULL_COLLECTIONS)) {
      invalid.push(id);
      continue;
    }
    if (!namesByPrefix.has(prefix)) namesByPrefix.set(prefix, new Set());
    namesByPrefix.get(prefix).add(match[2]);
  }
  if (invalid.length > 0) {
    throw new Error(`目录中存在无法识别的图标 id:${invalid.join(", ")}`);
  }

  const missing = [];
  const collections = {};
  let iconCount = 0;
  for (const prefix of [...namesByPrefix.keys()].sort()) {
    const full = FULL_COLLECTIONS[prefix];
    const icons = {};
    for (const name of [...namesByPrefix.get(prefix)].sort()) {
      // getIconData 会展开别名并合并集合级默认宽高,得到与运行时对完整
      // 集合调用 getIconData 完全一致的数据;子集里直接存这份解析结果。
      const data = getIconData(full, name);
      if (!data) {
        missing.push(`${prefix}:${name}`);
        continue;
      }
      icons[name] = data;
      iconCount += 1;
    }
    collections[prefix] = { prefix, icons };
  }
  if (missing.length > 0) {
    throw new Error(`以下图标在对应 @iconify-json 集合中不存在:${missing.join(", ")}`);
  }

  const payload = {
    version: 1,
    note: "由 scripts/build-icon-subset.mjs 生成,请勿手改;catalog.ts 变更后运行 pnpm build:icons 重新生成。",
    iconCount,
    collections,
  };
  const json = `${JSON.stringify(payload, null, 2)}\n`;
  const bytes = Buffer.byteLength(json, "utf8");
  if (bytes >= MAX_OUTPUT_BYTES) {
    throw new Error(
      `子集产物 ${(bytes / 1024).toFixed(1)}KB 超过 ${MAX_OUTPUT_BYTES / 1024}KB 上限,请先审视 catalog.ts 的图标规模`,
    );
  }
  writeFileSync(OUTPUT_PATH, json, "utf8");

  const perPrefix = Object.values(collections)
    .map((collection) => `${collection.prefix}=${Object.keys(collection.icons).length}`)
    .join(", ");
  console.log(
    `[build-icon-subset] 已写入 src/lib/icons/icon-subset.generated.json:共 ${iconCount} 个图标(${perPrefix}),${(bytes / 1024).toFixed(1)}KB`,
  );
}

main().catch((error) => {
  console.error(`[build-icon-subset] 失败:${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
