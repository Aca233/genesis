"use client";

import { use, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence } from "motion/react";
import type { WorldDeck, DeckCardKey } from "@/lib/cards/schemas";
import { DECK_CARD_KEYS, parsePersistedWorldDeck } from "@/lib/cards/schemas";
import {
  setPathClone,
  countLockedUnder,
  promoteMinorGod,
  clip,
  RANK_LABELS,
  RELATION_LABELS,
  CARD_KEY_LABELS,
  removeCreatorMajorGod,
} from "@/components/genesis/deck-utils";
import { DeckCard, GroupHeader } from "@/components/genesis/DeckCard";
import { CardEditorModal } from "@/components/genesis/CardEditorModal";
import {
  CosmologyEditor,
  FusionAxiomEditor,
  PlayerGodEditor,
  MajorGodEditor,
  MinorGodsEditor,
  FactionEditor,
  RaceEditor,
  PlaceEditor,
  EpochConflictEditor,
  StyleEditor,
  ThemeEditor,
} from "@/components/genesis/card-editors";
import { MajorCharacterEditor } from "@/components/genesis/MajorCharacterEditor";
import { GenesisCeremony } from "@/components/genesis/GenesisCeremony";
import { canEmbarkMode } from "@/components/genesis/embark-policy";
import {
  buildDeckPatchPayload,
  parseWorldRevision,
} from "@/components/genesis/editor-revision";
import {
  createEmbarkFlow,
  type EmbarkMaterialization,
} from "@/components/genesis/embark-flow";
import { streamNarration } from "@/components/play/sse-client";
import { PlayBackground } from "@/components/play/PlayBackground";
import { IconThemeControl, type IconThemeSummary } from "@/components/icons/IconThemeControl";

/**
 * 卡片编辑器（M1.4）+ 创世开局演出（M1.5）
 * 古籍笺卡片墙 → 全文编辑 / 重掷 / 手改上锁 / 议程封蜡 → 「创世」演出并 embark。
 */

type OpenCard =
  | { kind: "cosmology" | "fusionAxiom" | "playerGod" | "minorGods" | "epochConflict" | "style" | "theme" }
  | { kind: "majorGod" | "faction" | "race" | "majorCharacter" | "place"; index: number };

type EmbarkState =
  | { phase: "pending" }
  | { phase: "done" }
  | { phase: "error"; message: string };

export default function GenesisEditorPage({
  params,
}: {
  params: Promise<{ worldId: string }>;
}) {
  const { worldId } = use(params);
  const router = useRouter();

  // ── 世界数据 ──
  const [deck, setDeck] = useState<WorldDeck | null>(null);
  const [genesisInput, setGenesisInput] = useState("");
  const [lockedPaths, setLockedPaths] = useState<string[]>([]);
  const [revision, setRevision] = useState<string | null>(null);
  const [iconTheme, setIconTheme] = useState<IconThemeSummary | null>(null);
  const [iconThemeRevision, setIconThemeRevision] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  // ── 编辑状态 ──
  /** 未保存的手改路径（点分；整组结构性调整不计锁） */
  const [dirtyPaths, setDirtyPaths] = useState<Set<string>>(new Set());
  /** 结构性调整（增删/升格）也需要保存 */
  const [structDirty, setStructDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  // ── 交互状态 ──
  const [openCard, setOpenCard] = useState<OpenCard | null>(null);
  const [rerolling, setRerolling] = useState<DeckCardKey | null>(null);
  /** 已破封的天机（本地记忆）：majorGods.N / epochConflict */
  const [revealed, setRevealed] = useState<Set<string>>(new Set());

  // ── 演出状态 ──
  const [ceremony, setCeremony] = useState<EmbarkState | null>(null);
  const [openingRetry, setOpeningRetry] = useState(false);
  const embarkOnce = useRef(false);
  const embarkFlow = useRef<ReturnType<typeof createEmbarkFlow> | null>(null);

  const dirty = dirtyPaths.size > 0 || structDirty;

  // ── 加载 ──
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/worlds/${worldId}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error ?? "读取失败");
        return r.json();
      })
      .then(({ world }) => {
        if (cancelled) return;
        if (world.status !== "draft") {
          router.replace(`/play/${worldId}`);
          return;
        }
        const parsedDeck = parsePersistedWorldDeck(world.draftDeck);
        if (parsedDeck.mode !== world.mode) throw new Error("世界模式与草稿卡组不一致");
        setDeck(parsedDeck);
        setGenesisInput(world.genesisInput ?? "");
        setLockedPaths(world.lockedPaths ?? []);
        setRevision(parseWorldRevision(world.updatedAt));
        setIconTheme(world.iconTheme);
        setIconThemeRevision(world.iconThemeRevision ?? 0);
      })
      .catch((err) => !cancelled && setLoadError(String(err instanceof Error ? err.message : err)));
    return () => {
      cancelled = true;
    };
  }, [worldId, router]);

  // ── 手改 ──
  const handleEdit = useCallback((path: string, value: unknown) => {
    setDeck((d) => (d ? setPathClone(d, path, value) : d));
    // 整组结构性调整（如增删次要神）路径无「.」——不计字段锁，只标记待保存
    if ((DECK_CARD_KEYS as readonly string[]).includes(path)) {
      setStructDirty(true);
    } else {
      setDirtyPaths((s) => new Set(s).add(path));
    }
  }, []);

  /** 保存手改：PATCH {deck, editedPaths}。返回是否成功。 */
  const save = useCallback(
    async (current: WorldDeck): Promise<boolean> => {
      setSaving(true);
      setNotice(null);
      try {
        if (revision === null) throw new Error("世界版本无效，请刷新后重试");
        const res = await fetch(`/api/worlds/${worldId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildDeckPatchPayload(current, [...dirtyPaths], revision)),
        });
        const json = await res.json();
        if (!res.ok) {
          setNotice({ ok: false, text: `保存失败：${json.error ?? res.status}` });
          return false;
        }
        setLockedPaths(json.lockedPaths);
        setRevision(parseWorldRevision(json.updatedAt));
        setDirtyPaths(new Set());
        setStructDirty(false);
        setNotice({ ok: true, text: "✓ 手改已录，字段已上锁" });
        return true;
      } catch (err) {
        setNotice({ ok: false, text: `保存失败:${String(err)}` });
        return false;
      } finally {
        setSaving(false);
      }
    },
    [worldId, dirtyPaths, revision],
  );

  // ── 重掷（整组粒度；有未保存手改则先保存以免丢失） ──
  const reroll = useCallback(
    async (cardKey: DeckCardKey, note?: string) => {
      if (!deck || rerolling) return;
      if (dirty && !(await save(deck))) return;
      setRerolling(cardKey);
      setNotice(null);
      try {
        const res = await fetch(`/api/worlds/${worldId}/reroll`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cardKey, note }),
        });
        const json = await res.json();
        if (!res.ok) {
          setNotice({ ok: false, text: `重掷失败:${json.error ?? res.status}` });
          return;
        }
        const rerolled = parsePersistedWorldDeck(json.deck);
        if (rerolled.mode !== deck.mode) throw new Error("世界模式不可更改");
        setDeck(rerolled);
        setRevision(parseWorldRevision(json.updatedAt));
        setNotice({ ok: true, text: `✓ ${CARD_KEY_LABELS[cardKey]}已重掷（手改字段保留）` });
      } catch (err) {
        setNotice({ ok: false, text: `重掷失败:${String(err)}` });
      } finally {
        setRerolling(null);
      }
    },
    [deck, dirty, rerolling, save, worldId],
  );

  // ── 主神删除 / 次要神升格 ──
  const deleteMajorGod = useCallback(
    (index: number) => {
      if (!deck) return;
      const god = deck.majorGods[index];
      if (deck.majorGods.length <= 4) {
        setNotice({ ok: false, text: "主神席不得少于 4 位，不可再删" });
        return;
      }
      if (!window.confirm(`将「${god.name}」逐出主神席？此神的全部设定将被抹去。`)) return;
      setOpenCard(null);
      const majorGods = deck.mode === "creator"
        ? removeCreatorMajorGod(deck, index).majorGods
        : deck.majorGods.filter((_, i) => i !== index);
      handleEdit("majorGods", majorGods);
    },
    [deck, handleEdit],
  );

  const promote = useCallback(
    (index: number) => {
      if (!deck) return;
      if (deck.majorGods.length >= 10) {
        setNotice({ ok: false, text: "主神席已满（10 位），请先删减" });
        return;
      }
      const minor = deck.minorGods[index];
      const next: WorldDeck = deck.mode === "pantheon"
        ? {
            ...deck,
            majorGods: [...deck.majorGods, promoteMinorGod(minor, "pantheon")],
            minorGods: deck.minorGods.filter((_, i) => i !== index),
          }
        : {
            ...deck,
            majorGods: [...deck.majorGods, promoteMinorGod(minor, "creator", deck.majorGods[0]?.ref)],
            minorGods: deck.minorGods.filter((_, i) => i !== index),
          };
      setDeck(next);
      setStructDirty(true);
      setNotice({
        ok: true,
        text: `✓ 「${minor.name}」已升格为主神——其声纹与议程为占位模板，请重掷或手改完善`,
      });
    },
    [deck],
  );

  // ── 创世（演出 + embark 并行） ──
  const embark = useCallback(async () => {
    if (!deck || embarkOnce.current) return;
    // 有未保存手改先落盘（embark 以服务端草稿为准）
    if (dirty && !(await save(deck))) return;
    embarkOnce.current = true;
    setCeremony({ phase: "pending" });
    try {
      embarkFlow.current ??= createEmbarkFlow({
        worldId,
        materialize: async (): Promise<EmbarkMaterialization> => {
          const res = await fetch(`/api/worlds/${worldId}/embark`, {
            method: "POST",
          });
          const json = await res.json();
          if (!res.ok) {
            throw new Error(json.error ?? `开局失败（${res.status}）`);
          }
          return { chapterId: json.chapterId, temporal: json.temporal };
        },
        generateOpening: async (body) => {
          let failure: string | null = null;
          await streamNarration("/api/chat", body, {
            onText: () => undefined,
            onDone: () => undefined,
            onError: (message) => { failure = message; },
          });
          if (failure !== null) throw new Error(failure);
        },
      });
      await (embarkFlow.current.materialized
        ? embarkFlow.current.retryOpening()
        : embarkFlow.current.start());
      setOpeningRetry(false);
      setCeremony({ phase: "done" });
    } catch (err) {
      embarkOnce.current = false;
      setOpeningRetry(Boolean(embarkFlow.current?.materialized));
      setCeremony({ phase: "error", message: String(err) });
      setNotice({
        ok: false,
        text: embarkFlow.current?.materialized
          ? `开篇未成：${String(err)}`
          : `创世未成：${String(err)}`,
      });
    }
  }, [deck, dirty, save, worldId]);

  const ceremonyFinished = useCallback(() => {
    router.push(`/play/${worldId}`);
  }, [router, worldId]);

  // ── 渲染 ──
  if (loadError) {
    return (
      <main className="play-shell flex min-h-screen flex-1 items-center justify-center px-6">
        <PlayBackground variant="genesis" />
        <p className="genesis-status-panel text-cinnabar">{loadError}</p>
      </main>
    );
  }
  if (!deck) {
    return (
      <main className="play-shell flex min-h-screen flex-1 items-center justify-center text-ink-faint">
        <PlayBackground variant="genesis" />
        <p className="genesis-status-panel">展卷中…</p>
      </main>
    );
  }

  const busy = rerolling !== null;

  return (
    <main className="play-shell min-h-screen">
      <PlayBackground variant="genesis" />
      <div className="genesis-deck-page mx-auto w-full max-w-6xl px-6 pb-28 pt-10">
      {/* ── 顶部：世界名 + 原初神谕 ── */}
      <header className="genesis-deck-header mb-8 grid gap-3">
        <input
          value={deck.worldName}
          onChange={(e) => handleEdit("worldName", e.target.value)}
          aria-label="世界名"
          className="w-full max-w-xl border-b border-transparent bg-transparent text-4xl text-ink outline-none transition focus:border-gilt/50"
          style={{ fontFamily: "var(--font-display)" }}
        />
        {genesisInput && (
          <blockquote className="decree max-w-2xl text-sm leading-relaxed">
            {genesisInput}
          </blockquote>
        )}
        <p className="text-xs text-ink-faint">
          点开任意古籍笺细览全文；手改字段将上锁 🔒，重掷时保留。满意后点「创世」。
        </p>
      </header>

      {iconTheme && (
        <div className="mb-8">
          <IconThemeControl
            worldId={worldId}
            initialTheme={iconTheme}
            initialRevision={iconThemeRevision}
          />
        </div>
      )}

      {/* ── 宇宙论 ── */}
      <GroupHeader title="宇宙论" cardKey="cosmology" rerolling={rerolling === "cosmology"} disabled={busy} onReroll={reroll} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <DeckCard
          title="宇宙论"
          lines={[clip(`起源：${deck.cosmology.origin}`), clip(`力量：${deck.cosmology.powerSystem}`), clip(`神性：${deck.cosmology.divinity}`)]}
          lockedCount={countLockedUnder(lockedPaths, "cosmology")}
          rerolling={rerolling === "cosmology"}
          onOpen={() => setOpenCard({ kind: "cosmology" })}
        />
      </div>

      {/* ── 融合公理（仅多 IP 融合时） ── */}
      {deck.fusionAxiom && (
        <>
          <GroupHeader title="融合公理" cardKey="fusionAxiom" rerolling={rerolling === "fusionAxiom"} disabled={busy} onReroll={reroll} />
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <DeckCard
              title="融合公理"
              subtitle={deck.fusionAxiom.sourceIps.join(" × ")}
              lines={deck.fusionAxiom.axioms.slice(0, 3).map((a) => clip(a))}
              lockedCount={countLockedUnder(lockedPaths, "fusionAxiom")}
              rerolling={rerolling === "fusionAxiom"}
              onOpen={() => setOpenCard({ kind: "fusionAxiom" })}
            />
          </div>
        </>
      )}

      {/* ── 玩家神（仅诸神共世） ── */}
      {deck.mode === "pantheon" && (
        <>
          <GroupHeader title="汝之神格" cardKey="playerGod" rerolling={rerolling === "playerGod"} disabled={busy} onReroll={reroll} />
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <DeckCard
              title={deck.playerGod.name}
              subtitle={`${RANK_LABELS[deck.playerGod.rank]} · ${deck.playerGod.domains.join("、")}`}
              lines={[clip(`出身：${deck.playerGod.origin}`), clip(`处境：${deck.playerGod.situation}`)]}
              lockedCount={countLockedUnder(lockedPaths, "playerGod")}
              rerolling={rerolling === "playerGod"}
              onOpen={() => setOpenCard({ kind: "playerGod" })}
            />
          </div>
        </>
      )}

      {/* ── 主神 ── */}
      <GroupHeader
        title="神谱 · 主神"
        cardKey="majorGods"
        count={deck.majorGods.length}
        warning="重掷将重生成全部主神（手改字段保留）"
        rerolling={rerolling === "majorGods"}
        disabled={busy}
        onReroll={reroll}
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <AnimatePresence>
          {deck.mode === "pantheon"
            ? deck.majorGods.map((god, index) => (
                <DeckCard
                  key={god.ref}
                  title={god.name}
                  subtitle={`${RANK_LABELS[god.rank]} · ${god.domains.join("、")} · 关系：${RELATION_LABELS[god.initialRelationToPlayer.label]}`}
                  lines={[clip(god.persona)]}
                  lockedCount={countLockedUnder(lockedPaths, `majorGods.${index}`)}
                  sealed={!revealed.has(`majorGods.${index}`)}
                  rerolling={rerolling === "majorGods"}
                  openIndex={index}
                  onOpen={() => setOpenCard({ kind: "majorGod", index })}
                />
              ))
            : deck.majorGods.map((god, index) => (
                <DeckCard
                  key={god.ref}
                  title={god.name}
                  subtitle={`${RANK_LABELS[god.rank]} · ${god.domains.join("、")} · 神际关系：${god.relations.length} 条`}
                  lines={[clip(god.persona)]}
                  lockedCount={countLockedUnder(lockedPaths, `majorGods.${index}`)}
                  sealed={!revealed.has(`majorGods.${index}`)}
                  rerolling={rerolling === "majorGods"}
                  openIndex={index}
                  onOpen={() => setOpenCard({ kind: "majorGod", index })}
                />
              ))}
        </AnimatePresence>
      </div>

      {/* ── 次要神 ── */}
      <GroupHeader title="次要神" cardKey="minorGods" count={deck.minorGods.length} rerolling={rerolling === "minorGods"} disabled={busy} onReroll={reroll} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <DeckCard
          title="次要神列表"
          subtitle="一句话小神，可升格入主神席"
          lines={
            deck.minorGods.length
              ? deck.minorGods.slice(0, 4).map((g) => clip(`${g.name}——${g.brief}`)).concat(deck.minorGods.length > 4 ? [`……共 ${deck.minorGods.length} 位`] : [])
              : ["（此界暂无小神）"]
          }
          lockedCount={countLockedUnder(lockedPaths, "minorGods")}
          rerolling={rerolling === "minorGods"}
          onOpen={() => setOpenCard({ kind: "minorGods" })}
        />
      </div>

      {/* ── 势力 ── */}
      <GroupHeader
        title="势力"
        cardKey="factions"
        count={deck.factions.length}
        warning="重掷将重生成全部势力（手改字段保留）"
        rerolling={rerolling === "factions"}
        disabled={busy}
        onReroll={reroll}
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {deck.factions.map((f, i) => (
          <DeckCard
            key={f.ref}
            title={f.name}
            subtitle={f.kind}
            lines={[clip(f.overview), clip(`信仰:${f.faith}`)]}
            lockedCount={countLockedUnder(lockedPaths, `factions.${i}`)}
            rerolling={rerolling === "factions"}
            openIndex={i}
            onOpen={() => setOpenCard({ kind: "faction", index: i })}
          />
        ))}
      </div>

      {/* ── 种族 ── */}
      <GroupHeader
        title="种族"
        cardKey="races"
        count={deck.races.length}
        warning="重掷将重生成全部种族（手改字段保留）"
        rerolling={rerolling === "races"}
        disabled={busy}
        onReroll={reroll}
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {deck.races.map((r, i) => (
          <DeckCard
            key={r.ref}
            title={r.name}
            subtitle={`寿命:${r.lifespan}`}
            lines={[clip(r.traits), clip(`渊源:${r.divineTies}`)]}
            lockedCount={countLockedUnder(lockedPaths, `races.${i}`)}
            rerolling={rerolling === "races"}
            openIndex={i}
            onOpen={() => setOpenCard({ kind: "race", index: i })}
          />
        ))}
      </div>

      {/* ── 主要人物 ── */}
      <GroupHeader
        title="主要人物"
        cardKey="majorCharacters"
        count={deck.majorCharacters.length}
        warning="重掷将重生成全部主要人物（手改字段保留）"
        rerolling={rerolling === "majorCharacters"}
        disabled={busy}
        onReroll={reroll}
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {deck.majorCharacters.map((character, index) => {
          const race = deck.races.find((entry) => entry.ref === character.raceRef);
          const skillCount = character.learnedTraditionRefs.length + character.racialOverrides.length + character.abilities.length;
          return (
            <DeckCard
              key={character.ref}
              title={character.name}
              subtitle={`${character.identity} · ${race?.name ?? character.raceRef}`}
              lines={[clip(`目标：${character.goals}`), clip(`技能：${skillCount} 项`)]}
              lockedCount={countLockedUnder(lockedPaths, `majorCharacters.${index}`)}
              rerolling={rerolling === "majorCharacters"}
              openIndex={index}
              onOpen={() => setOpenCard({ kind: "majorCharacter", index })}
            />
          );
        })}
      </div>

      {/* ── 地理 ── */}
      <GroupHeader
        title="山河舆图"
        cardKey="places"
        count={deck.places.length}
        warning="重掷将重生成全部地理（手改字段保留）"
        rerolling={rerolling === "places"}
        disabled={busy}
        onReroll={reroll}
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {deck.places.map((p, i) => (
          <DeckCard
            key={p.ref}
            title={p.name}
            subtitle={`${p.kind} · ${clip(p.allegiance, 20)}`}
            lines={[clip(p.overview)]}
            lockedCount={countLockedUnder(lockedPaths, `places.${i}`)}
            rerolling={rerolling === "places"}
            openIndex={i}
            onOpen={() => setOpenCard({ kind: "place", index: i })}
          />
        ))}
      </div>

      {/* ── 纪元冲突 / 叙事风格 / 主题措辞 ── */}
      <GroupHeader title="纪元冲突" cardKey="epochConflict" rerolling={rerolling === "epochConflict"} disabled={busy} onReroll={reroll} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <DeckCard
          title={deck.epochConflict.epochName}
          subtitle={deck.epochConflict.yearLabel}
          lines={deck.epochConflict.overtConflicts.slice(0, 3).map((c) => clip(c))}
          lockedCount={countLockedUnder(lockedPaths, "epochConflict")}
          sealed={!revealed.has("epochConflict")}
          rerolling={rerolling === "epochConflict"}
          onOpen={() => setOpenCard({ kind: "epochConflict" })}
        />
      </div>

      <GroupHeader title="叙事风格" cardKey="style" rerolling={rerolling === "style"} disabled={busy} onReroll={reroll} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <DeckCard
          title={deck.style.presetName}
          lines={[clip(deck.style.toneNotes, 80)]}
          lockedCount={countLockedUnder(lockedPaths, "style")}
          rerolling={rerolling === "style"}
          onOpen={() => setOpenCard({ kind: "style" })}
        />
      </div>

      <GroupHeader title="主题措辞" cardKey="theme" rerolling={rerolling === "theme"} disabled={busy} onReroll={reroll} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <DeckCard
          title={deck.theme.eraSystem}
          lines={[clip(`位阶：${Object.values(deck.theme.rankNames).join("—")}`, 80), clip(`称谓：${deck.theme.addressStyle}`)]}
          lockedCount={countLockedUnder(lockedPaths, "theme")}
          rerolling={rerolling === "theme"}
          onOpen={() => setOpenCard({ kind: "theme" })}
        />
      </div>

      {/* ── 全文编辑 Modal ── */}
      <CardEditorModal
        open={openCard !== null}
        title={modalTitle(openCard, deck)}
        onClose={() => setOpenCard(null)}
      >
        {openCard?.kind === "cosmology" && (
          <CosmologyEditor deck={deck} lockedPaths={lockedPaths} onEdit={handleEdit} />
        )}
        {openCard?.kind === "fusionAxiom" && (
          <FusionAxiomEditor deck={deck} lockedPaths={lockedPaths} onEdit={handleEdit} />
        )}
        {openCard?.kind === "playerGod" && deck.mode === "pantheon" && (
          <PlayerGodEditor deck={deck} lockedPaths={lockedPaths} onEdit={handleEdit} />
        )}
        {openCard?.kind === "majorGod" && (
          <>
            <MajorGodEditor
              deck={deck}
              index={openCard.index}
              lockedPaths={lockedPaths}
              onEdit={handleEdit}
              agendaRevealed={revealed.has(`majorGods.${openCard.index}`)}
              onRevealAgenda={() =>
                setRevealed((s) => new Set(s).add(`majorGods.${openCard.index}`))
              }
            />
            <button
              type="button"
              onClick={() => deleteMajorGod(openCard.index)}
              className="mt-2 justify-self-start rounded-md border border-cinnabar/40 px-4 py-1.5 text-sm text-cinnabar transition hover:bg-cinnabar/10"
            >
              逐出主神席
            </button>
          </>
        )}
        {openCard?.kind === "minorGods" && (
          <MinorGodsEditor deck={deck} lockedPaths={lockedPaths} onEdit={handleEdit} onPromote={promote} />
        )}
        {openCard?.kind === "faction" && (
          <FactionEditor deck={deck} index={openCard.index} lockedPaths={lockedPaths} onEdit={handleEdit} />
        )}
        {openCard?.kind === "race" && (
          <RaceEditor deck={deck} index={openCard.index} lockedPaths={lockedPaths} onEdit={handleEdit} />
        )}
        {openCard?.kind === "majorCharacter" && (
          <MajorCharacterEditor deck={deck} index={openCard.index} lockedPaths={lockedPaths} onEdit={handleEdit} />
        )}
        {openCard?.kind === "place" && (
          <PlaceEditor deck={deck} index={openCard.index} lockedPaths={lockedPaths} onEdit={handleEdit} />
        )}
        {openCard?.kind === "epochConflict" && (
          <EpochConflictEditor
            deck={deck}
            lockedPaths={lockedPaths}
            onEdit={handleEdit}
            currentsRevealed={revealed.has("epochConflict")}
            onRevealCurrents={() => setRevealed((s) => new Set(s).add("epochConflict"))}
          />
        )}
        {openCard?.kind === "style" && (
          <StyleEditor deck={deck} lockedPaths={lockedPaths} onEdit={handleEdit} />
        )}
        {openCard?.kind === "theme" && (
          <ThemeEditor deck={deck} lockedPaths={lockedPaths} onEdit={handleEdit} />
        )}
      </CardEditorModal>

      </div>

      {/* ── 底部固定条 ── */}
      <footer className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-paper-raised/95 backdrop-blur-sm">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-3">
          <div className="flex items-center gap-4 text-sm">
            {notice && (
              <span className={notice.ok ? "text-gilt" : "text-cinnabar"}>{notice.text}</span>
            )}
            {ceremony?.phase === "error" && (
              <button
                type="button"
                onClick={embark}
                className="rounded-md border border-cinnabar px-3 py-1 text-cinnabar transition hover:bg-cinnabar/10"
              >
                {openingRetry ? "重试开篇" : "重试创世"}
              </button>
            )}
          </div>
          <div className="flex items-center gap-3">
            {dirty && (
              <button
                type="button"
                onClick={() => void save(deck)}
                disabled={saving || busy}
                className="rounded-md border border-line px-4 py-2 text-sm text-ink-soft transition hover:border-gilt/50 hover:text-gilt disabled:opacity-40"
              >
                {saving ? "落笔中…" : "保存手改"}
              </button>
            )}
            <button
              type="button"
              onClick={embark}
              disabled={!canEmbarkMode(deck.mode) || saving || busy || ceremony?.phase === "pending"}
              className="rounded-md border border-gilt bg-gilt/10 px-10 py-2 text-lg tracking-widest text-gilt transition hover:bg-gilt/20 disabled:opacity-40"
              style={{ fontFamily: "var(--font-display)" }}
            >
              创　世
            </button>
          </div>
        </div>
      </footer>

      {/* ── 创世演出 ── */}
      <AnimatePresence>
        {ceremony && ceremony.phase !== "error" && (
          <GenesisCeremony
            decree={genesisInput || `${deck.worldName}，自此有史。`}
            deck={deck}
            embark={ceremony}
            onFinished={ceremonyFinished}
          />
        )}
      </AnimatePresence>
    </main>
  );
}

/** Modal 标题 */
function modalTitle(open: OpenCard | null, deck: WorldDeck): string {
  if (!open) return "";
  switch (open.kind) {
    case "cosmology":
      return "宇宙论";
    case "fusionAxiom":
      return "融合公理";
    case "playerGod":
      return deck.mode === "pantheon" ? `汝之神格 · ${deck.playerGod.name}` : "";
    case "majorGod":
      return `主神 · ${deck.majorGods[open.index]?.name ?? ""}`;
    case "minorGods":
      return "次要神列表";
    case "faction":
      return `势力 · ${deck.factions[open.index]?.name ?? ""}`;
    case "race":
      return `种族 · ${deck.races[open.index]?.name ?? ""}`;
    case "majorCharacter":
      return `主要人物 · ${deck.majorCharacters[open.index]?.name ?? ""}`;
    case "place":
      return `地理 · ${deck.places[open.index]?.name ?? ""}`;
    case "epochConflict":
      return "纪元冲突";
    case "style":
      return "叙事风格";
    case "theme":
      return "主题措辞";
  }
}
