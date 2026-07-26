"use client";

import type { SvgIconData } from "@/components/icons/WorldIcon";

/**
 * 程序纹章：蜡封印章风格 SVG（docs/01 §9.2）。
 * 纯确定性——同 seed 同图；imageUrl 有则渲染圆形裁切图。
 * 类型倾向：faction=盾纹 / character=侧影线 / race=枝叶 / place=山川 / artifact=菱纹 / cult=星芒。
 */

/** seed 字符串 → 伪随机数序列（mulberry32） */
function rng(seed: string): () => number {
  let h = 1779033703;
  for (const ch of seed) {
    h = Math.imul(h ^ ch.codePointAt(0)!, 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function polygon(cx: number, cy: number, r: number, n: number, rot = 0): string {
  const pts: string[] = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (i * 2 * Math.PI) / n;
    pts.push(`${(cx + r * Math.sin(a)).toFixed(1)},${(cy - r * Math.cos(a)).toFixed(1)}`);
  }
  return pts.join(" ");
}

function star(cx: number, cy: number, rOut: number, rIn: number, n: number): string {
  const pts: string[] = [];
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 === 0 ? rOut : rIn;
    const a = (i * Math.PI) / n;
    pts.push(`${(cx + r * Math.sin(a)).toFixed(1)},${(cy - r * Math.cos(a)).toFixed(1)}`);
  }
  return pts.join(" ");
}

function innerMotif(type: string, rand: () => number): React.ReactNode {
  const stroke = "var(--ink-soft)";
  switch (type) {
    case "faction": {
      // 盾形 + 内分割线
      const split = rand() > 0.5;
      return (
        <g stroke={stroke} strokeWidth="1.6" fill="none">
          <path d="M 24 13 L 34 17 V 27 Q 34 34 24 38 Q 14 34 14 27 V 17 Z" />
          {split ? <line x1="24" y1="13" x2="24" y2="38" /> : <line x1="14" y1="24" x2="34" y2="24" />}
          <circle cx="24" cy="24" r={2 + rand() * 2} fill={stroke} stroke="none" />
        </g>
      );
    }
    case "character": {
      // 抽象侧影弧线
      const tilt = (rand() - 0.5) * 6;
      return (
        <g stroke={stroke} strokeWidth="1.6" fill="none">
          <circle cx={22 + tilt} cy="19" r="5.5" />
          <path d={`M ${14 + tilt} 36 Q ${22 + tilt} 26 ${30 + tilt} 36`} />
          <path d={`M ${25 + tilt} 15 q ${3 + rand() * 4} ${-2} ${6} 1`} />
        </g>
      );
    }
    case "race": {
      // 枝叶对生
      const branches = 2 + Math.floor(rand() * 2);
      return (
        <g stroke={stroke} strokeWidth="1.5" fill="none">
          <line x1="24" y1="12" x2="24" y2="37" />
          {Array.from({ length: branches }, (_, i) => {
            const y = 17 + i * 7;
            const len = 7 - i * 1.2;
            return (
              <g key={i}>
                <path d={`M 24 ${y} q -${len} -2 -${len + 2} -6`} />
                <path d={`M 24 ${y + 3} q ${len} -2 ${len + 2} -6`} />
              </g>
            );
          })}
        </g>
      );
    }
    case "place": {
      // 山川
      const peak = 15 + rand() * 4;
      return (
        <g stroke={stroke} strokeWidth="1.6" fill="none">
          <path d={`M 12 33 L 21 ${peak} L 27 26 L 31 20 L 36 33`} strokeLinejoin="round" />
          <path d="M 13 36.5 q 5 2.5 11 0 t 11 0" strokeWidth="1.2" />
        </g>
      );
    }
    case "artifact": {
      // 菱纹嵌套
      const n = 2 + Math.floor(rand() * 2);
      return (
        <g stroke={stroke} strokeWidth="1.5" fill="none">
          {Array.from({ length: n }, (_, i) => (
            <polygon key={i} points={polygon(24, 24.5, 11 - i * 4, 4)} />
          ))}
          <circle cx="24" cy="24.5" r="1.6" fill={stroke} stroke="none" />
        </g>
      );
    }
    case "cult": {
      // 星芒
      const rays = 5 + Math.floor(rand() * 3);
      return (
        <g stroke={stroke} strokeWidth="1.5" fill="none">
          <polygon points={star(24, 24.5, 11, 4.5, rays)} strokeLinejoin="round" />
          <circle cx="24" cy="24.5" r="2.5" />
        </g>
      );
    }
    default:
      return <polygon points={polygon(24, 24.5, 9, 6)} stroke={stroke} strokeWidth="1.5" fill="none" />;
  }
}

export function Emblem({
  seed,
  type,
  size = 40,
  imageUrl,
  motif,
  className,
}: {
  seed: string;
  type: string;
  size?: number;
  imageUrl?: string | null;
  motif?: SvgIconData | null;
  className?: string;
}) {
  if (imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={imageUrl}
        alt=""
        width={size}
        height={size}
        className={`rounded-full border border-gilt/40 object-cover ${className ?? ""}`}
        style={{ width: size, height: size }}
      />
    );
  }

  if (size < 30 && motif) {
    return (
      <svg
        viewBox={`0 0 ${motif.width} ${motif.height}`}
        width={size}
        height={size}
        className={className}
        style={{ color: "var(--ink-soft)" }}
        aria-hidden
        dangerouslySetInnerHTML={{ __html: motif.body }}
      />
    );
  }

  const rand = rng(seed + type);
  const rot = rand() * 360;

  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      className={className}
      style={{ color: "var(--ink-soft)" }}
      aria-hidden
    >
      {/* 蜡封外圈 */}
      <circle cx="24" cy="24" r="22" fill="var(--paper-sunken)" stroke="var(--gilt)" strokeWidth="1.6" />
      <circle
        cx="24"
        cy="24"
        r="19"
        fill="none"
        stroke="var(--line)"
        strokeWidth="1"
        strokeDasharray={`${2 + rand() * 3} ${2 + rand() * 2}`}
        transform={`rotate(${rot.toFixed(0)} 24 24)`}
      />
      {motif ? (
        <svg
          x="13"
          y="13"
          width="22"
          height="22"
          viewBox={`0 0 ${motif.width} ${motif.height}`}
          dangerouslySetInnerHTML={{ __html: motif.body }}
        />
      ) : innerMotif(type, rand)}
    </svg>
  );
}
