"use client";

import { useEffect } from "react";
import { motion, useSpring, useTransform } from "motion/react";
import type { Scale } from "@/lib/cards/schemas";

/**
 * 时之仪：时速表式的叙事尺度调节盘。
 * 半圆表盘+指针，五档位（瞬息/场景/数载/年代/纪元）。
 * 指针不用 SVG transform（易因 transform-origin 兼容问题整体乱摆），
 * 而是直接对端点坐标做 spring 动画。
 */

export const SCALE_STOPS: {
  key: Scale;
  label: string;
  hint: string;
  placeholder: string;
  angle: number; // 相对正上方的指针角度
}[] = [
  { key: "moment", label: "一瞬", hint: "一息之间，纤毫毕现", placeholder: "此一瞬，你……", angle: -72 },
  { key: "scene", label: "一幕", hint: "此刻此地，逐句成章", placeholder: "此刻，你将……", angle: -36 },
  { key: "years", label: "数年", hint: "寒来暑往，数年一卷", placeholder: "此后数年……", angle: 0 },
  { key: "era", label: "数十年", hint: "数十载光阴，如卷疾书", placeholder: "此后数十载……", angle: 36 },
  { key: "epoch", label: "百年", hint: "百年千载，史官笔法", placeholder: "此后百年……", angle: 72 },
];

const CX = 65;
const CY = 58;

function polar(angle: number, r: number) {
  const rad = (angle * Math.PI) / 180;
  return { x: CX + r * Math.sin(rad), y: CY - r * Math.cos(rad) };
}

export function ScaleDial({
  scale,
  disabled,
  onChange,
}: {
  scale: Scale;
  disabled?: boolean;
  onChange: (s: Scale) => void;
}) {
  const current = SCALE_STOPS.find((s) => s.key === scale) ?? SCALE_STOPS[1];

  // 对「角度」本身做 spring —— 指针沿扇形弧线扫过（而非端点直线插值）
  const angleSpring = useSpring(current.angle, { stiffness: 300, damping: 24 });
  useEffect(() => {
    angleSpring.set(current.angle);
  }, [current.angle, angleSpring]);
  const tipX = useTransform(angleSpring, (a) => polar(a, 34).x);
  const tipY = useTransform(angleSpring, (a) => polar(a, 34).y);

  /** 点按表盘：按点击点相对轴心的方位角就近选档 */
  function pick(e: React.MouseEvent<SVGSVGElement>) {
    if (disabled) return;
    const rect = e.currentTarget.getBoundingClientRect();
    // viewBox 130x70 → 像素坐标换算
    const sx = ((e.clientX - rect.left) / rect.width) * 130;
    const sy = ((e.clientY - rect.top) / rect.height) * 70;
    const angle = (Math.atan2(sx - CX, CY - sy) * 180) / Math.PI;
    let best = SCALE_STOPS[0];
    for (const s of SCALE_STOPS) {
      if (Math.abs(s.angle - angle) < Math.abs(best.angle - angle)) best = s;
    }
    onChange(best.key);
  }

  const stopIndex = SCALE_STOPS.findIndex((s) => s.key === current.key);

  /** 方向键步进选档（焦点样式由全局 :focus-visible 覆盖） */
  function step(e: React.KeyboardEvent<SVGSVGElement>) {
    if (disabled) return;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      if (stopIndex > 0) onChange(SCALE_STOPS[stopIndex - 1].key);
    } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      if (stopIndex < SCALE_STOPS.length - 1) onChange(SCALE_STOPS[stopIndex + 1].key);
    }
  }

  return (
    <div
      className={`select-none ${disabled ? "opacity-50" : ""}`}
      title={`时之仪 · ${current.label}——${current.hint}`}
    >
      <svg
        viewBox="0 0 130 70"
        onClick={pick}
        onKeyDown={step}
        tabIndex={disabled ? -1 : 0}
        className={`h-[78px] w-[146px] overflow-visible ${disabled ? "" : "cursor-pointer"}`}
        role="slider"
        aria-label="叙事时间尺度"
        aria-valuetext={current.label}
        aria-valuemin={0}
        aria-valuemax={4}
        aria-valuenow={stopIndex}
        aria-disabled={disabled || undefined}
      >
        {/* 表盘弧（深墨案面上以亮金弦线镌出） */}
        <path
          d={`M ${polar(-80, 40).x} ${polar(-80, 40).y} A 40 40 0 0 1 ${polar(80, 40).x} ${polar(80, 40).y}`}
          fill="none"
          stroke="color-mix(in srgb, var(--gilt-bright) 38%, transparent)"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        {/* 刻度与档名：镌刻宋体，当前档鎏金微焕 */}
        {SCALE_STOPS.map((s) => {
          const o = polar(s.angle, 40);
          const i = polar(s.angle, 33);
          const t = polar(s.angle, 49);
          const active = s.key === scale;
          return (
            <g
              key={s.key}
              style={active
                ? { filter: "drop-shadow(0 0 3px var(--seal-glow))" }
                : undefined}
            >
              <line
                x1={i.x}
                y1={i.y}
                x2={o.x}
                y2={o.y}
                stroke={active
                  ? "var(--gilt-bright)"
                  : "color-mix(in srgb, var(--gilt-bright) 34%, transparent)"}
                strokeWidth={active ? 2.5 : 1.5}
                strokeLinecap="round"
              />
              <text
                x={t.x}
                y={t.y}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize="10"
                fontWeight={active ? 700 : 400}
                style={{ fontFamily: "var(--font-display)" }}
                fill={active
                  ? "var(--gilt-bright)"
                  : "color-mix(in srgb, var(--gilt-bright) 58%, transparent)"}
              >
                {s.label}
              </text>
            </g>
          );
        })}
        {/* 指针：角度 spring → 弧线扫过（扇形运动） */}
        <motion.line
          x1={CX}
          y1={CY}
          x2={tipX}
          y2={tipY}
          stroke="var(--gilt-bright)"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        {/* 轴心：鎏金钮，微焕 */}
        <circle
          cx={CX}
          cy={CY}
          r="3.5"
          fill="var(--gilt-bright)"
          style={{ filter: "drop-shadow(0 0 2px var(--gilt-glow))" }}
        />
      </svg>
      {/* 窄屏可见档位提示（弥补 title 悬停在触屏不可达；深墨案面上用亮金） */}
      <span className="hidden text-[10px] text-gilt-bright/60 max-sm:block">
        {current.hint}
      </span>
    </div>
  );
}
