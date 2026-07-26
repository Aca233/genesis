"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  AbilityEventView,
  AbilityView,
  CharacterMembershipView,
  CharacterRelationsView,
  EntityRelationView,
  ThemeCard,
} from "./types";
import { Emblem } from "./Emblem";
import { IconPicker, type IconAssignmentView } from "@/components/icons/IconPicker";
import { AbilityList } from "./AbilityList";
import { SaveMaterialVersionButton } from "@/components/materials/SaveMaterialVersionButton";
import { entityTypeName, ENTITY_TYPE_ORDER, sectionName } from "./lexicon";
import {
  completeCodexDetailLoad,
  emptyCodexDetailState,
  failCodexDetailLoad,
} from "./codex-detail-state";

/**
 * 众生录：六类实体分组列表 + 详情卡（docs/01 §9.2）。
 * 措辞随世界观：类名取主题卡 typeNames，栏目标题取史官生成的 content.title。
 * 迷雾：未揭示栏目显示传闻残卷；手改即锁（playerLocked）。
 * heat=dormant → 淡墨折叠；isChosen → 神选金环。
 */

type EntityLite = {
  id: string;
  type: string;
  name: string;
  aliases: string[];
  emblemSeed: string;
  imageUrl: string | null;
  starred: boolean;
  isChosen: boolean;
  heat: string;
  summary: string;
  scenePresence: boolean;
  iconAssignment: IconAssignmentView;
};

type SectionRow = {
  id: string;
  key: string;
  /** title 由史官按世界观措辞生成；缺省回退 lexicon 通用名。开局种子含 names 列表形 */
  content: { title?: string; text?: string; names?: string[] } | null;
  revealed: boolean;
  rumorText: string | null;
  playerLocked: boolean;
  worldVisible?: boolean;
};

type EntityDetail = EntityLite & {
  worldId: string;
  timelineId: string;
  iconAssignment: IconAssignmentView;
  sections: SectionRow[];
  abilities: AbilityView[];
  race?: { id: string; name: string; summary: string } | null;
  memberships?: CharacterMembershipView[];
  relations?: CharacterRelationsView;
  abilityEvents?: AbilityEventView[];
};

type ChronicleRow = {
  id: string;
  chapterIndex: number;
  yearLabel: string;
  text: string;
  revealedAtChapter: number | null;
  revealedAtTimeLabel?: string | null;
  worldVisible?: boolean;
};

// ── 列表 ──

function EntityRow({
  entity,
  onOpen,
  onStar,
}: {
  entity: EntityLite;
  onOpen: () => void;
  onStar: () => void;
}) {
  const dormant = entity.heat === "dormant";
  return (
    <li
      className={`flex items-center gap-3 rounded-lg border p-3 transition hover:border-gilt/40 ${
        entity.isChosen
          ? "border-gilt/50 bg-paper-raised"
          : "border-line bg-paper-raised"
      } ${dormant ? "opacity-55" : ""}`}
    >
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left"
      >
        <Emblem
          seed={entity.emblemSeed}
          type={entity.type}
          size={38}
          imageUrl={entity.imageUrl}
          motif={entity.iconAssignment.icon}
        />
        <span className="block min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-sm text-ink">
            <span className="truncate">{entity.name}</span>
            {entity.isChosen && (
              <span className="shrink-0 text-[10px] text-gilt" title="神选者">
                ◈ 神选
              </span>
            )}
            {entity.scenePresence && (
              <span
                className="shrink-0 text-[10px] text-cinnabar/70"
                title="在场"
              >
                ·在场
              </span>
            )}
          </span>
          <span className="block truncate text-xs text-ink-faint">
            {dormant ? "（尘封）" : ""}
            {entity.summary}
          </span>
        </span>
      </button>
      <button
        type="button"
        onClick={onStar}
        aria-pressed={entity.starred}
        aria-label={entity.starred ? "取消标星" : "标星（常驻上下文）"}
        className={`shrink-0 text-base transition ${
          entity.starred ? "text-gilt" : "text-ink-faint/40 hover:text-gilt/60"
        }`}
        title={entity.starred ? "取消标星" : "标星（常驻上下文）"}
      >
        {entity.starred ? "★" : "☆"}
      </button>
    </li>
  );
}

// ── 详情 ──

function SectionBlock({ s }: { s: SectionRow }) {
  return (
    <section className="border-t border-line pt-2.5">
      <h4 className="mb-1 flex items-center gap-2 text-xs tracking-widest text-ink-faint">
        {s.content?.title || sectionName(s.key)}
        {s.playerLocked && (
          <span className="text-[10px] text-gilt/60" title="手书已锁，史官不改">
            ✎ 亲录
          </span>
        )}
      </h4>
      {s.content !== null ? (
        <>
          {s.worldVisible === false && (
            <p className="mb-1 text-[10px] tracking-widest text-cinnabar/75">天外批注 · 世界内不可见</p>
          )}
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-soft">
          {s.content?.text ?? s.content?.names?.join("、") ?? ""}
        </p>
        </>
      ) : (
        <p className="fog-text text-sm">
          {s.rumorText ? `传闻：${s.rumorText}` : "此处经卷残缺"}
        </p>
      )}
    </section>
  );
}

function RelationRow({
  relation,
  onOpenEntity,
}: {
  relation: EntityRelationView;
  onOpenEntity: (id: string) => void;
}) {
  const related = relation.direction === "outgoing"
    ? relation.target
    : relation.source;
  return (
    <li className="rounded-md border border-line bg-paper-sunken/45 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded border border-gilt/35 px-1.5 py-0.5 text-xs text-gilt">
          {relation.label}
        </span>
        <span className="text-[10px] tracking-wider text-ink-faint">
          {relation.direction === "outgoing" ? "我方所系" : "对方所系"}
        </span>
        <button
          type="button"
          data-entity-id={related.id}
          onClick={() => onOpenEntity(related.id)}
          className="text-gilt underline decoration-gilt/40 underline-offset-2 transition hover:text-ink"
        >
          {related.name}
        </button>
        {relation.worldVisible === false && (
          <span className="text-[10px] text-cinnabar/80">世界内尚未知晓</span>
        )}
      </div>
      {relation.note && (
        <p className="mt-1 text-xs leading-relaxed text-ink-soft">{relation.note}</p>
      )}
    </li>
  );
}

export function CharacterRelations({
  relations,
  onOpenEntity,
}: {
  relations: CharacterRelationsView;
  onOpenEntity: (id: string) => void;
}) {
  const rows: EntityRelationView[] = [
    ...relations.outgoing,
    ...relations.incoming,
  ];
  return (
    <div>
      <h4 className="mb-2 text-xs tracking-widest text-ink-faint">人物关系</h4>
      {rows.length > 0 ? (
        <ul className="grid gap-2">
          {rows.map((relation) => (
            <RelationRow
              key={`${relation.direction}:${relation.id}`}
              relation={relation}
              onOpenEntity={onOpenEntity}
            />
          ))}
        </ul>
      ) : (
        <p className="fog-text text-sm">尚无载入册中的人物关系</p>
      )}
    </div>
  );
}

export function EntityChronicle({ chronicle }: { chronicle: readonly ChronicleRow[] }) {
  if (chronicle.length === 0) return null;
  return (
    <div className="border-t border-line pt-3">
      <h4 className="mb-2 text-xs tracking-widest text-ink-faint">其史</h4>
      <ul className="grid gap-2">
        {chronicle.map((entry) => (
          <li key={entry.id} className="flex gap-3 text-sm">
            <span className="shrink-0 text-xs text-gilt/70">{entry.yearLabel}</span>
            <span className="text-ink-soft">
              {entry.text}
              {entry.worldVisible === false && (
                <span className="ml-1 text-xs text-cinnabar/80">〔天外批注 · 世界内不可见〕</span>
              )}
              {entry.revealedAtChapter != null && (
                <span className="ml-1 text-xs text-ink-faint">
                  （{entry.revealedAtTimeLabel ? `${entry.revealedAtTimeLabel}方揭` : "后世方揭"}）
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function EntityDetailView({
  entityId,
  theme,
  onBack,
  onStarred,
  onOpenEntity,
}: {
  entityId: string;
  theme: ThemeCard | null;
  onBack: (() => void) | null;
  onStarred: (id: string, starred: boolean) => void;
  onOpenEntity: (id: string) => void;
}) {
  const [loadState, setLoadState] = useState(() =>
    emptyCodexDetailState<EntityDetail, ChronicleRow>(),
  );
  const { detail, chronicle, abilityHistory, error, loading } = loadState;
  const [iconAssignment, setIconAssignment] = useState<IconAssignmentView | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/codex/${entityId}`);
        const json = (await res.json()) as {
          entity?: EntityDetail;
          chronicle?: ChronicleRow[];
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok || !json.entity) {
          setLoadState(failCodexDetailLoad(json.error ?? "此册无从寻觅"));
          return;
        }
        setLoadState((previous) =>
          completeCodexDetailLoad(
            previous,
            json.entity!,
            json.chronicle ?? [],
            json.entity!.abilityEvents ?? [],
          ),
        );
        setIconAssignment(json.entity!.iconAssignment);
      } catch (err) {
        if (!cancelled) {
          setLoadState(
            failCodexDetailLoad(err instanceof Error ? err.message : String(err)),
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entityId]);

  const toggleStar = useCallback(async () => {
    if (!detail) return;
    const next = !detail.starred;
    setLoadState((previous) => ({
      ...previous,
      detail: previous.detail ? { ...previous.detail, starred: next } : null,
    }));
    onStarred(detail.id, next);
    await fetch(`/api/codex/${detail.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ starred: next }),
    });
  }, [detail, onStarred]);

  if (loading) return <p className="fog-text text-sm">展卷中…</p>;
  if (error) return <p className="text-sm text-cinnabar">{error}</p>;
  if (!detail) return <p className="fog-text text-sm">展卷中…</p>;

  return (
    <div className="grid gap-4">
      {onBack && (
        <button
          onClick={onBack}
          className="justify-self-start text-sm text-ink-faint transition hover:text-gilt"
        >
          ← 回众生录
        </button>
      )}

      <header className="flex items-start gap-4">
        <Emblem
          seed={detail.emblemSeed}
          type={detail.type}
          size={56}
          imageUrl={detail.imageUrl}
          motif={iconAssignment?.icon ?? detail.iconAssignment.icon}
        />
        <div className="min-w-0 flex-1">
          <h3
            className="flex items-center gap-2 text-xl text-ink"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {detail.name}
            <button
              onClick={toggleStar}
              className={`text-base ${detail.starred ? "text-gilt" : "text-ink-faint/40 hover:text-gilt/60"}`}
              title={detail.starred ? "取消标星" : "标星（常驻上下文）"}
            >
              {detail.starred ? "★" : "☆"}
            </button>
          </h3>
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-faint">
            <span className="rounded border border-line px-1.5 py-0.5">
              {entityTypeName(theme, detail.type)}
            </span>
            {detail.isChosen && (
              <span className="rounded border border-gilt/50 px-1.5 py-0.5 text-gilt">
                ◈ 神选者
              </span>
            )}
            {detail.heat === "dormant" && <span>（尘封）</span>}
            {detail.aliases.length > 0 && (
              <span>又称：{detail.aliases.join("、")}</span>
            )}
          </p>
          <div className="mt-2"><SaveMaterialVersionButton sourceType="entity" sourceId={detail.id} compact /></div>
          <div className="mt-2">
            <IconPicker
              worldId={detail.worldId}
              timelineId={detail.timelineId}
              subjectType="entity"
              subjectId={detail.id}
              value={iconAssignment ?? detail.iconAssignment}
              onChange={setIconAssignment}
            />
          </div>
        </div>
      </header>

      <p className="text-sm leading-relaxed text-ink-soft">{detail.summary}</p>

      <div className="grid gap-3">
        {detail.sections.map((s) => (
          <SectionBlock key={s.id} s={s} />
        ))}
        {detail.sections.length === 0 && (
          <p className="fog-text text-sm">册页尚薄——待岁月充实。</p>
        )}
      </div>

      {detail.type === "race" && (
        <section className="border-t border-line pt-3">
          <h4 className="mb-3 text-xs tracking-widest text-ink-faint">种族能力</h4>
          <AbilityList
            abilities={detail.abilities}
            historyByAbilityId={abilityHistory}
            kinds={["racial_innate", "racial_tradition"]}
            allowMaterialSave
          />
        </section>
      )}

      {detail.type === "character" && (
        <section className="grid gap-4 border-t border-line pt-3">
          <div>
            <h4 className="mb-2 text-xs tracking-widest text-ink-faint">出身与归属</h4>
            <div className="grid gap-2 text-sm text-ink-soft">
              {detail.race ? (
                <p>
                  种族：
                  <button
                    type="button"
                    onClick={() => onOpenEntity(detail.race!.id)}
                    className="text-gilt underline decoration-gilt/40 underline-offset-2 transition hover:text-ink"
                  >
                    {detail.race.name}
                  </button>
                </p>
              ) : (
                <p className="fog-text">种族谱系尚未载明</p>
              )}
              {(detail.memberships?.length ?? 0) > 0 && (
                <div>
                  <p className="mb-1 text-xs text-ink-faint">势力与职务</p>
                  <ul className="grid gap-1">
                    {detail.memberships!.map((membership) => (
                      <li key={membership.id}>
                        <button
                          type="button"
                          onClick={() => onOpenEntity(membership.faction.id)}
                          className="text-gilt underline decoration-gilt/40 underline-offset-2 transition hover:text-ink"
                        >
                          {membership.faction.name}
                        </button>
                        <span> · {membership.role}</span>
                        {membership.isPrimary && <span className="ml-1 text-xs text-gilt/75">（主要归属）</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
          <CharacterRelations
            relations={detail.relations ?? { outgoing: [], incoming: [] }}
            onOpenEntity={onOpenEntity}
          />
          <AbilityList
            abilities={detail.abilities}
            historyByAbilityId={abilityHistory}
            kinds={["racial_innate", "racial_tradition", "personal"]}
            allowMaterialSave
            labels={{
              racial_innate: "继承来源",
              racial_tradition: "已掌握技艺",
              personal: "个人技能",
            }}
          />
        </section>
      )}

      <EntityChronicle chronicle={chronicle} />
    </div>
  );
}

// ── 面板 ──

export function CodexPanel({
  timelineId,
  theme,
  initialEntityId,
}: {
  timelineId: string;
  theme: ThemeCard | null;
  initialEntityId?: string | null;
}) {
  const [entities, setEntities] = useState<EntityLite[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(initialEntityId ?? null);
  const [filter, setFilter] = useState("");
  const [listError, setListError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/codex?timelineId=${timelineId}`);
      const json = (await res.json().catch(() => null)) as
        | { entities?: EntityLite[]; error?: string }
        | null;
      if (!res.ok || !json?.entities) {
        setListError(json?.error ?? "众生录读取失败，请稍后再试");
        return;
      }
      setEntities(json.entities);
      setListError(null);
    } catch (err) {
      console.error("众生录读取失败", err);
      setListError("众生录读取失败，请稍后再试");
    }
  }, [timelineId]);

  useEffect(() => {
    // defer：避免 effect 内同步 setState
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const star = useCallback(
    async (id: string, starred: boolean) => {
      // 乐观更新 + 失败回滚（仿 MaterialLibrary.patch）
      const before = entities;
      setEntities((es) =>
        es ? es.map((e) => (e.id === id ? { ...e, starred } : e)) : es,
      );
      try {
        const res = await fetch(`/api/codex/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ starred }),
        });
        if (!res.ok) throw new Error("星标未能落笔");
      } catch (err) {
        console.error("星标更新失败", err);
        setEntities(before);
        setListError("星标未能落笔，请稍后再试");
      }
    },
    [entities],
  );

  if (openId) {
    return (
      <EntityDetailView
        key={openId}
        entityId={openId}
        theme={theme}
        onBack={() => {
          setOpenId(null);
          void load(); // 详情页星标可能变过 → 回列表刷新
        }}
        onStarred={(id, starred) =>
          setEntities((es) =>
            es ? es.map((e) => (e.id === id ? { ...e, starred } : e)) : es,
          )
        }
        onOpenEntity={setOpenId}
      />
    );
  }

  if (!entities) {
    if (listError) {
      return (
        <p className="text-sm text-cinnabar">
          {listError}{" "}
          <button
            type="button"
            className="underline transition hover:text-ink"
            onClick={() => {
              setListError(null);
              void load();
            }}
          >
            重试
          </button>
        </p>
      );
    }
    return <p className="fog-text text-sm">展卷中…</p>;
  }
  if (entities.length === 0) {
    return <p className="fog-text text-sm">众生尚未入册——史官将在世界变化后清点。</p>;
  }

  const q = filter.trim();
  const shown = q
    ? entities.filter(
        (e) =>
          e.name.includes(q) ||
          e.aliases.some((a) => a.includes(q)) ||
          e.summary.includes(q),
      )
    : entities;

  return (
    <div className="grid gap-5">
      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        aria-label="检索众生"
        placeholder="检索众生（名讳 / 别称 / 摘要）…"
        className="w-full rounded-md border border-line bg-paper-sunken px-3 py-1.5 text-sm text-ink outline-none placeholder:text-ink-faint/60 focus:border-gilt/50"
      />

      {listError && (
        <p role="alert" className="text-sm text-cinnabar">{listError}</p>
      )}

      {ENTITY_TYPE_ORDER.map((type) => {
        const group = shown.filter((e) => e.type === type);
        if (group.length === 0) return null;
        return (
          <div key={type}>
            <h3 className="mb-2 text-xs tracking-widest text-ink-faint">
              {entityTypeName(theme, type)}
              <span className="ml-1.5 text-ink-faint/60">{group.length}</span>
            </h3>
            <ul className="grid gap-2">
              {group.map((e) => (
                <EntityRow
                  key={e.id}
                  entity={e}
                  onOpen={() => setOpenId(e.id)}
                  onStar={() => void star(e.id, !e.starred)}
                />
              ))}
            </ul>
          </div>
        );
      })}
      {shown.length === 0 && (
        <p className="fog-text text-sm">无一众生应此检索。</p>
      )}
    </div>
  );
}
