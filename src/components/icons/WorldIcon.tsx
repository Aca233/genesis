import type { CSSProperties } from "react";

export type SvgIconData = {
  body: string;
  width: number;
  height: number;
};

const FALLBACK_ICON: SvgIconData = {
  body: "<path fill=\"none\" stroke=\"currentColor\" stroke-linecap=\"round\" stroke-linejoin=\"round\" stroke-width=\"2\" d=\"M9.1 9a3 3 0 1 1 5.83 1c0 2-3 2-3 4m.07 4h.01\"/>",
  width: 24,
  height: 24,
};

export function WorldIcon({
  icon,
  size = 20,
  label,
  className,
}: {
  icon?: SvgIconData | null;
  size?: number;
  label?: string;
  className?: string;
}) {
  const resolved = icon ?? FALLBACK_ICON;
  const accessibility = label
    ? { role: "img", "aria-label": label }
    : { "aria-hidden": true as const };
  return (
    <svg
      {...accessibility}
      className={className}
      width={size}
      height={size}
      viewBox={`0 0 ${resolved.width} ${resolved.height}`}
      focusable="false"
      style={{ display: "block", flex: "0 0 auto" } satisfies CSSProperties}
      dangerouslySetInnerHTML={{ __html: resolved.body }}
    />
  );
}
