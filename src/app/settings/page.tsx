"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

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
    <fieldset className="rounded-lg border border-line bg-paper-raised p-5">
      <legend
        className="px-2 text-lg text-ink"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {title}
      </legend>
      <p className="mb-4 text-xs text-ink-faint">{subtitle}</p>

      <div className="grid gap-3">
        <label className="grid gap-1 text-sm text-ink-soft">
          协议
          <select
            value={slot.provider}
            onChange={(e) =>
              onChange({ ...slot, provider: e.target.value as SlotForm["provider"] })
            }
            className="rounded-md border border-line bg-paper-sunken p-2 text-ink outline-none focus:border-gilt/60"
          >
            <option value="openai-compatible">OpenAI 兼容 / 中转站</option>
            <option value="anthropic">Anthropic</option>
            <option value="gemini">Gemini</option>
          </select>
          <span className="text-xs text-ink-faint">{PROVIDER_HINTS[slot.provider]}</span>
        </label>

        <label className="grid gap-1 text-sm text-ink-soft">
          Base URL
          <input
            value={slot.baseUrl}
            onChange={(e) => onChange({ ...slot, baseUrl: e.target.value })}
            placeholder="https://…"
            className="rounded-md border border-line bg-paper-sunken p-2 text-ink outline-none focus:border-gilt/60"
          />
        </label>

        <label className="grid gap-1 text-sm text-ink-soft">
          API Key
          <input
            type="password"
            value={slot.apiKey}
            onChange={(e) => onChange({ ...slot, apiKey: e.target.value })}
            placeholder={slot.hasKey ? "●●●●●●●●（已保存，留空则不变）" : "sk-…"}
            className="rounded-md border border-line bg-paper-sunken p-2 text-ink outline-none focus:border-gilt/60"
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <div className="relative grid content-start gap-1 text-sm text-ink-soft">
            <span className="flex items-center justify-between">
              模型名
              <button
                type="button"
                onClick={() => void fetchModels()}
                disabled={listing || !slot.baseUrl}
                className="text-xs text-gilt/70 transition hover:text-gilt disabled:opacity-40"
                title="从端点取回可用模型列表"
              >
                {listing ? "取名录中…" : "📜 取诸名录"}
              </button>
            </span>
            <input
              value={slot.model}
              onChange={(e) => {
                onChange({ ...slot, model: e.target.value });
                if (models) setPickerOpen(true);
              }}
              onFocus={() => {
                if (models) setPickerOpen(true);
              }}
              onBlur={() => setTimeout(() => setPickerOpen(false), 150)}
              placeholder="claude-sonnet-4-5 / gpt-4o / gemini-2.5-pro…"
              className="rounded-md border border-line bg-paper-sunken p-2 text-ink outline-none focus:border-gilt/60"
            />
            {listError && (
              <span className="text-xs text-cinnabar">{listError}</span>
            )}
            {/* 名录下拉（输入即筛选） */}
            {pickerOpen && models && (
              <div className="absolute top-full z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-line bg-paper-raised shadow-lg">
                {filtered.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-ink-faint">
                    名录中无匹配（共 {models.length} 个）
                  </p>
                ) : (
                  filtered.map((m) => (
                    <button
                      key={m}
                      type="button"
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
          <label className="grid gap-1 text-sm text-ink-soft">
            温度（可选）
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
              className="rounded-md border border-line bg-paper-sunken p-2 text-ink outline-none focus:border-gilt/60"
            />
          </label>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={onTest}
            disabled={testing || !slot.baseUrl || !slot.model}
            className="rounded-md border border-gilt/50 px-4 py-1.5 text-sm text-gilt transition hover:bg-gilt/10 disabled:opacity-40"
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
    </fieldset>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const [narrative, setNarrative] = useState<SlotForm>(EMPTY_SLOT);
  const [backstage, setBackstage] = useState<SlotForm | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedTick, setSavedTick] = useState(false);
  const [testing, setTesting] = useState<"narrative" | "backstage" | null>(null);
  const [testResults, setTestResults] = useState<
    Partial<Record<"narrative" | "backstage", { ok: boolean; text: string }>>
  >({});

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
      }
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
      <main className="flex flex-1 items-center justify-center text-ink-faint">
        展卷中…
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-12">
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
        <h1
          className="text-3xl text-ink"
          style={{ fontFamily: "var(--font-display)" }}
        >
          ⚱ 香炉 · 设置
        </h1>
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
            <button
              onClick={() => setBackstage(null)}
              className="mt-2 text-xs text-ink-faint hover:text-cinnabar"
            >
              移除幕后槽（回落叙事模型）
            </button>
          </div>
        ) : (
          <button
            onClick={() => setBackstage(EMPTY_SLOT)}
            className="rounded-lg border border-dashed border-line p-4 text-sm text-ink-faint transition hover:border-gilt/40 hover:text-gilt"
          >
            + 配置幕后模型（可选：诸神回合与结算用便宜模型，省钱提速）
          </button>
        )}

        <div className="flex items-center gap-4">
          <button
            onClick={save}
            disabled={saving || !narrative.baseUrl || !narrative.model}
            className="rounded-md border border-gilt/50 bg-gilt/5 px-8 py-2 text-gilt transition hover:bg-gilt/15 disabled:opacity-40"
          >
            {saving ? "封存中…" : "封存设置"}
          </button>
          {savedTick && <span className="text-sm text-gilt">✓ 已封存</span>}
        </div>
      </div>
    </main>
  );
}
