"use client";

import { useState } from "react";
import { isPathLocked } from "./deck-utils";

/** 卡片编辑器通用字段控件：文本 / 多行 / 下拉 / 字符串数组（可增删行）+ 封蜡块 */

const inputCls =
  "w-full rounded-md border border-line bg-paper-sunken px-3 py-2 text-sm text-ink outline-none transition focus:border-gilt/60";

export type FieldCommon = {
  label: string;
  /** 点分路径，如 "majorGods.2.persona" */
  path: string;
  lockedPaths: string[];
  onEdit: (path: string, value: unknown) => void;
};

/** 锁标记：手改字段，重掷时保留 */
function LabelRow({ label, locked }: { label: string; locked: boolean }) {
  return (
    <span className="flex flex-wrap items-center gap-1 text-xs text-ink-faint">
      {label}
      {locked && (
        <span
          className="cursor-help text-gilt/80"
          title="手改字段，重掷时保留"
        >
          🔒 <span className="text-[10px]">手改字段，重掷时保留</span>
        </span>
      )}
    </span>
  );
}

export function TextField({
  label,
  path,
  value,
  lockedPaths,
  onEdit,
  placeholder,
}: FieldCommon & { value: string; placeholder?: string }) {
  return (
    <label className="grid gap-1">
      <LabelRow label={label} locked={isPathLocked(lockedPaths, path)} />
      <input
        name={path}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onEdit(path, e.target.value)}
        className={inputCls}
      />
    </label>
  );
}

export function TextAreaField({
  label,
  path,
  value,
  lockedPaths,
  onEdit,
  rows = 3,
}: FieldCommon & { value: string; rows?: number }) {
  return (
    <label className="grid gap-1">
      <LabelRow label={label} locked={isPathLocked(lockedPaths, path)} />
      <textarea
        name={path}
        value={value}
        rows={rows}
        onChange={(e) => onEdit(path, e.target.value)}
        className={`${inputCls} resize-y leading-relaxed`}
      />
    </label>
  );
}

export function SelectField({
  label,
  path,
  value,
  options,
  lockedPaths,
  onEdit,
}: FieldCommon & {
  value: string;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="grid gap-1">
      <LabelRow label={label} locked={isPathLocked(lockedPaths, path)} />
      <select
        name={path}
        value={value}
        onChange={(e) => onEdit(path, e.target.value)}
        className={inputCls}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** 字符串数组字段：逐行编辑，可增删行（增删记整组路径锁） */
export function ListField({
  label,
  path,
  values,
  lockedPaths,
  onEdit,
  placeholder,
}: FieldCommon & { values: string[]; placeholder?: string }) {
  return (
    <div className="grid gap-1">
      <LabelRow label={label} locked={isPathLocked(lockedPaths, path)} />
      <div className="grid gap-1.5">
        {values.map((v, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              value={v}
              placeholder={placeholder}
              onChange={(e) =>
                onEdit(
                  path,
                  values.map((x, j) => (j === i ? e.target.value : x)),
                )
              }
              className={inputCls}
            />
            <button
              type="button"
              title="删去此行"
              onClick={() =>
                onEdit(
                  path,
                  values.filter((_, j) => j !== i),
                )
              }
              className="shrink-0 text-ink-faint transition hover:text-cinnabar"
            >
              ✕
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => onEdit(path, [...values, ""])}
          className="justify-self-start rounded-md border border-dashed border-line px-3 py-1 text-xs text-ink-faint transition hover:border-gilt/40 hover:text-gilt"
        >
          ＋ 添一行
        </button>
      </div>
    </div>
  );
}

/** 封蜡块：天机默认隐藏，点击弹出确认后由外层翻开（本地状态记忆） */
export function SealedBlock({
  stamp = "天机 · 封",
  message,
  onReveal,
}: {
  stamp?: string;
  message: string;
  onReveal: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="rounded-md border border-[#4a3b28] bg-[#2a2118] p-6 text-center">
      {!confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="mx-auto flex flex-col items-center gap-2"
        >
          <span
            className="inline-block rounded-full border-2 border-cinnabar px-5 py-4 text-lg tracking-widest text-cinnabar"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {stamp}
          </span>
          <span className="text-xs text-[#e8dfc8]/45">
            蜡封未启 · 点击窥探
          </span>
        </button>
      ) : (
        <div className="grid gap-3">
          <p className="text-sm leading-relaxed text-[#e8dfc8]/85">{message}</p>
          <div className="flex justify-center gap-3">
            <button
              type="button"
              onClick={onReveal}
              className="rounded-md border border-cinnabar px-4 py-1.5 text-sm text-cinnabar transition hover:bg-cinnabar/15"
            >
              破封
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-md border border-[#e8dfc8]/25 px-4 py-1.5 text-sm text-[#e8dfc8]/60 transition hover:border-[#e8dfc8]/50"
            >
              罢了
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** 编辑器内小节标题 */
export function Sect({ title }: { title: string }) {
  return (
    <h3
      className="mt-3 border-b border-line pb-1 text-sm tracking-wide text-gilt"
      style={{ fontFamily: "var(--font-display)" }}
    >
      {title}
    </h3>
  );
}
