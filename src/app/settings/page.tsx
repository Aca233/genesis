"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CelestialPageShell } from "@/components/layout/CelestialPageShell";
import { IdentitySection } from "@/components/settings/IdentitySection";
import { PromptCacheStats } from "@/components/settings/PromptCacheStats";

type SlotForm = {
  provider: "openai-compatible" | "anthropic" | "gemini";
  baseUrl: string;
  apiKey: string; // 明文，仅提交瞬间使用；空 = 保留已存 Key
  model: string;
  temperature?: number;
  hasKey?: boolean;
};

const EMPTY_SLOT: SlotForm = {
  provider: "openai-compatible",
  baseUrl: "",
  apiKey: "",
  model: "",
};

const PROVIDER_HINTS: Record<SlotForm["provider"], string> = {
  "openai-compatible":
    "OpenAI 兼容协议（含各类中转站）。Base URL 通常以 /v1 结尾（如 https://api.example.com/v1）；漏写 /v1 时系统会自动尝试补全。",
  anthropic: "Anthropic 官方协议。Base URL 如 https://api.anthropic.com",
  gemini: "Google Gemini 协议。Base URL 如 https://generativelanguage.googleapis.com",
};

/** 黄铜小器钮：玺印钮的紧凑变体（试炼一问 / 取诸名录 共用同一式样） */
const BRASS_BUTTON = "seal-button min-h-8! px-3.5! py-1! text-xs";

/** 羊皮纸凹井：带内阴影的输入面，聚焦时鎏金微焕 */
const FIELD_WELL =
  "w-full rounded-lg border border-line bg-paper-sunken px-3 py-2 text-ink shadow-[inset_0_1px_2px_color-mix(in_srgb,var(--ink)_10%,transparent)] outline-none transition-[border-color,box-shadow] focus:border-gilt/70 focus:shadow-[inset_0_1px_2px_color-mix(in_srgb,var(--ink)_10%,transparent),0_0_0.6rem_var(--gilt-glow)]";

function SlotEditor({
  title,
  subtitle,
  slot,
  slotName,
  onChange,
  onTest,
  testing,
  testResult,
}: {
  title: string;
  subtitle: string;
  slot: SlotForm;
  /** 已保存槽位名（未填明文 key 时用已存密文取名录/试炼） */
  slotName: "narrative" | "backstage";
  onChange: (s: SlotForm) => void;
  onTest: () => void;
  testing: boolean;
  testResult: { ok: boolean; text: string } | null;
}) {
  // 模型名录：取回的列表 + 筛选下拉
  const [models, setModels] = useState<string[] | null>(null);
  const [listing, setListing] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  async function fetchModels() {
    if (listing || !slot.baseUrl) return;
    setListing(true);
    setListError(null);
    try {
      const res = await fetch("/api/settings/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: slot.provider,
          baseUrl: slot.baseUrl,
          ...(slot.apiKey ? { apiKey: slot.apiKey } : { useSaved: slotName }),
        }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "取名录失败");
      setModels(json.models);
      setPickerOpen(true);
    } catch (err) {
      setListError(err instanceof Error ? err.message : String(err));
    } finally {
      setListing(false);
    }
  }

  // 筛选：模型名输入即过滤
  const filtered =
    models?.filter((m) =>
      m.toLowerCase().includes(slot.model.trim().toLowerCase()),
    ) ?? [];

  return (
    <section
      aria-labelledby={`${slotName}-slot-title`}
      className="tome-plate tome-plate--corners p-5 sm:p-6"
    >
      <h2 id={`${slotName}-slot-title`} className="illuminated-header display-md">
        <span className="illuminated-header__glyph" aria-hidden="true">
          ✦
        </span>
        {title}
      </h2>
      <p className="mt-2 mb-5 text-center text-xs text-ink-faint">{subtitle}</p>

      <div className="grid gap-4">
        <label className="grid gap-1.5 text-sm text-ink-soft">
          <span className="letterpress">协议</span>
          <select
            value={slot.provider}
            onChange={(e) =>
              onChange({ ...slot, provider: e.target.value as SlotForm["provider"] })
            }
            className="scroll-select w-full"
          >
            <option value="openai-compatible">OpenAI 兼容 / 中转站</option>
            <option value="anthropic">Anthropic</option>
            <option value="gemini">Gemini</option>
          </select>
          <span className="text-xs text-ink-faint">{PROVIDER_HINTS[slot.provider]}</span>
        </label>

        <label className="grid gap-1.5 text-sm text-ink-soft">
          <span className="letterpress">Base URL</span>
          <input
            value={slot.baseUrl}
            onChange={(e) => onChange({ ...slot, baseUrl: e.target.value })}
            placeholder="https://…"
            className={FIELD_WELL}
          />
        </label>

        <label className="grid gap-1.5 text-sm text-ink-soft">
          <span className="letterpress">API Key</span>
          <input
            type="password"
            value={slot.apiKey}
            onChange={(e) => onChange({ ...slot, apiKey: e.target.value })}
            placeholder={slot.hasKey ? "●●●●●●●●（已保存，留空则不变）" : "sk-…"}
            className={`${FIELD_WELL} placeholder:text-xs`}
          />
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="relative grid min-w-0 content-start gap-1.5 text-sm text-ink-soft">
            <span className="flex items-center justify-between gap-2">
              <span className="letterpress">模型名</span>
              <button
                type="button"
                onClick={() => void fetchModels()}
                disabled={listing || !slot.baseUrl}
                className={BRASS_BUTTON}
                title="从端点取回可用模型列表"
              >
                {listing ? "取名录中…" : "取诸名录"}
              </button>
            </span>
            <input
              value={slot.model}
              aria-label="模型名"
              role="combobox"
              aria-expanded={pickerOpen}
              aria-controls={`${slotName}-model-listbox`}
              aria-autocomplete="list"
              onChange={(e) => {
                onChange({ ...slot, model: e.target.value });
                if (models) setPickerOpen(true);
              }}
              onFocus={() => {
                if (models) setPickerOpen(true);
              }}
              onBlur={() => setTimeout(() => setPickerOpen(false), 150)}
              placeholder="claude-sonnet-4-5 / gpt-4o / gemini-2.5-pro…"
              className={FIELD_WELL}
            />
            {listError && (
              <span className="text-xs text-cinnabar">{listError}</span>
            )}
            {/* 名录下拉（输入即筛选） */}
            {pickerOpen && models && (
              <div
                id={`${slotName}-model-listbox`}
                role="listbox"
                className="tome-scroll absolute top-full z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-gilt/35 bg-paper-raised shadow-tome"
              >
                {filtered.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-ink-faint">
                    名录中无匹配（共 {models.length} 个）
                  </p>
                ) : (
                  filtered.map((m) => (
                    <button
                      key={m}
                      type="button"
                      role="option"
                      aria-selected={m === slot.model}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        onChange({ ...slot, model: m });
                        setPickerOpen(false);
                      }}
                      className={`block w-full truncate px-3 py-1.5 text-left text-sm transition hover:bg-gilt/10 hover:text-gilt ${
                        m === slot.model ? "text-gilt" : "text-ink"
                      }`}
                      title={m}
                    >
                      {m}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
          <label className="grid min-w-0 content-start gap-1.5 text-sm text-ink-soft">
            <span className="flex min-h-8 items-center">
              <span className="letterpress">温度（可选）</span>
            </span>
            <input
              type="number"
              step="0.1"
              min="0"
              max="2"
              value={slot.temperature ?? ""}
              onChange={(e) =>
                onChange({
                  ...slot,
                  temperature:
                    e.target.value === "" ? undefined : Number(e.target.value),
                })
              }
              className={FIELD_WELL}
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={onTest}
            disabled={testing || !slot.baseUrl || !slot.model}
            className={BRASS_BUTTON}
          >
            {testing ? "试炼中…" : "试炼一问"}
          </button>
          {testResult && (
            <span
              className={`text-sm ${testResult.ok ? "text-gilt" : "text-cinnabar"}`}
            >
              {testResult.text}
            </span>
          )}
        </div>
      </div>
    </section>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const [narrative, setNarrative] = useState<SlotForm>(EMPTY_SLOT);
  const [backstage, setBackstage] = useState<SlotForm | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedTick, setSavedTick] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [testing, setTesting] = useState<"narrative" | "backstage" | null>(null);
  const [testResults, setTestResults] = useState<
    Partial<Record<"narrative" | "backstage", { ok: boolean; text: string }>>
  >({});
  // 对局偏好：AI 行动建议开关（纯本地偏好，读取侧在 InputDeck）
  const [suggestionsOn, setSuggestionsOn] = useState(true);

  useEffect(() => {
    setSuggestionsOn(
      window.localStorage.getItem("chuangshi:ai-suggestions") !== "off",
    );
  }, []);

  function toggleSuggestions() {
    const next = !suggestionsOn;
    window.localStorage.setItem("chuangshi:ai-suggestions", next ? "on" : "off");
    setSuggestionsOn(next);
  }

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        if (data.narrativeSlot) {
          setNarrative({ ...EMPTY_SLOT, ...data.narrativeSlot, apiKey: "" });
        }
        if (data.backstageSlot) {
          setBackstage({ ...EMPTY_SLOT, ...data.backstageSlot, apiKey: "" });
        }
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      const payload = {
        narrativeSlot: toPayload(narrative),
        backstageSlot: backstage ? toPayload(backstage) : null,
      };
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setSavedTick(true);
        setTimeout(() => setSavedTick(false), 2000);
      } else {
        const json = await res.json().catch(() => ({}));
        setSaveError(json.error ?? `封存失败（${res.status}）`);
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  function toPayload(s: SlotForm) {
    return {
      provider: s.provider,
      baseUrl: s.baseUrl,
      model: s.model,
      temperature: s.temperature,
      ...(s.apiKey ? { apiKey: s.apiKey } : {}),
    };
  }

  async function test(which: "narrative" | "backstage") {
    const slot = which === "narrative" ? narrative : backstage;
    if (!slot) return;
    setTesting(which);
    setTestResults((r) => ({ ...r, [which]: undefined }));
    try {
      const res = await fetch("/api/settings/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slot: toPayload(slot),
          useSaved: slot.apiKey ? undefined : which,
        }),
      });
      const json = await res.json();
      setTestResults((r) => ({
        ...r,
        [which]: json.ok
          ? { ok: true, text: `✓ ${json.reply}` }
          : { ok: false, text: `✗ ${json.error}` },
      }));
    } catch (err) {
      setTestResults((r) => ({
        ...r,
        [which]: { ok: false, text: `✗ ${String(err)}` },
      }));
    } finally {
      setTesting(null);
    }
  }

  if (!loaded) {
    return (
      <CelestialPageShell contentClassName="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-2xl items-center justify-center text-ink-faint">
        展卷中…
      </CelestialPageShell>
    );
  }

  return (
    <CelestialPageShell contentClassName="mx-auto w-full max-w-2xl">
      <header className="mb-8">
        <button
          onClick={() => {
            if (window.history.length > 1) router.back();
            else router.push("/");
          }}
          className="mb-4 text-sm text-ink-faint transition hover:text-gilt"
        >
          ← 归返
        </button>
        <h1 className="display-lg text-ink">设置</h1>
        <p className="mt-2 text-sm text-ink-faint">
          你的 Key 以 AES-256-GCM 加密存于本地数据库，仅在请求时解密转发。
        </p>
      </header>

      <div className="grid gap-6">
        <SlotEditor
          title="叙事模型"
          slotName="narrative"
          subtitle="主正文生成。建议使用你最好的模型。"
          slot={narrative}
          onChange={setNarrative}
          onTest={() => test("narrative")}
          testing={testing === "narrative"}
          testResult={testResults.narrative ?? null}
        />

        {backstage ? (
          <div>
            <SlotEditor
              title="幕后模型"
              slotName="backstage"
              subtitle="诸神回合、状态抽取、编年史压缩。可填便宜快的模型。"
              slot={backstage}
              onChange={setBackstage}
              onTest={() => test("backstage")}
              testing={testing === "backstage"}
              testResult={testResults.backstage ?? null}
            />
            <div className="mt-2 flex justify-end">
              <button
                onClick={() => setBackstage(null)}
                className="text-xs text-ink-faint hover:text-cinnabar"
              >
                移除幕后槽（回落叙事模型）
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setBackstage(EMPTY_SLOT)}
            className="rounded-xl border border-dashed border-gilt/35 bg-paper-raised/40 p-4 text-sm text-ink-faint transition hover:border-gilt/70 hover:text-gilt"
          >
            + 配置幕后模型（可选：诸神回合与结算用便宜模型，省钱提速）
          </button>
        )}

        <section
          className="tome-plate p-5 sm:p-6"
          aria-labelledby="play-prefs-title"
        >
          <h2 id="play-prefs-title" className="illuminated-header display-md">
            <span className="illuminated-header__glyph" aria-hidden="true">
              ✦
            </span>
            对局偏好
          </h2>
          <div className="mt-4 flex items-center justify-between gap-4">
            <div className="text-sm text-ink-soft">
              AI 行动建议
              <p className="mt-0.5 text-xs text-ink-faint">
                每轮叙事后附上 2-4 条可点选的行动建议；关闭后只留自由书写。
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={suggestionsOn}
              aria-label="AI 行动建议"
              onClick={toggleSuggestions}
              className={`relative h-6 w-11 shrink-0 rounded-full border transition ${
                suggestionsOn
                  ? "border-gilt/60 bg-gilt/25 shadow-[0_0_0.5rem_var(--gilt-glow)]"
                  : "border-line bg-paper-sunken"
              }`}
            >
              <span
                aria-hidden="true"
                className={`absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full transition-all ${
                  suggestionsOn ? "left-6 bg-gilt" : "left-1 bg-ink-faint"
                }`}
              />
            </button>
          </div>
        </section>

        <PromptCacheStats />

        <IdentitySection />

        <section className="tome-plate p-5 sm:p-6" aria-labelledby="icon-license-title">
          <h2 id="icon-license-title" className="illuminated-header display-md">
            <span className="illuminated-header__glyph" aria-hidden="true">
              ✦
            </span>
            图标与开源许可
          </h2>
          <ul className="mt-4 grid gap-2 text-sm text-ink-soft">
            <li>Phosphor Icons — MIT</li>
            <li>Tabler Icons — MIT</li>
            <li>IconPark Outline — Apache 2.0</li>
            <li>
              Game Icons — <a className="text-gilt hover:underline" href="https://creativecommons.org/licenses/by/3.0/" target="_blank" rel="noreferrer">CC BY 3.0</a>；具体作者与来源按世界实际使用图标写入导出存档的 <code>iconCreditsMarkdown</code>。
            </li>
          </ul>
        </section>

        <div className="flex flex-wrap items-center gap-4">
          <button
            onClick={save}
            disabled={saving || !narrative.baseUrl || !narrative.model}
            className="seal-button"
          >
            {saving ? "封存中…" : "封存设置"}
          </button>
          {savedTick && <span className="text-sm text-gilt">✓ 已封存</span>}
          {saveError && <span className="text-sm text-cinnabar">✗ {saveError}</span>}
        </div>
      </div>
    </CelestialPageShell>
  );
}
