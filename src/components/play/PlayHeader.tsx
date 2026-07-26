import Link from "next/link";

/**
 * 章头饰条：世界名·纪元·时间的泥金细带。
 * 宋体章题 + 下缘两端淡出的鎏金发丝线；底衬纵向渐隐纸底，
 * 上滚正文在饰条之下渐次消隐，而非与标题相撞。
 * （图标主题调校台属幕后工具，只在创世/设置语境出现，不入对局书页。）
 */
export function PlayHeader({
  worldName,
  era,
  time,
}: {
  worldName: string;
  era: string;
  time: string;
}) {
  return (
    <header
      className="pointer-events-none sticky top-0 z-20 px-3 pb-8 pt-2 sm:px-6"
      style={{
        background:
          "linear-gradient(to bottom, var(--paper) 0%, color-mix(in srgb, var(--paper) 92%, transparent) 40%, color-mix(in srgb, var(--paper) 55%, transparent) 68%, transparent 100%)",
      }}
    >
      <div className="grid grid-cols-[auto_1fr_auto] items-center">
        <Link
          href="/"
          aria-label="返回主菜单"
          className="pointer-events-auto rounded-md border border-gilt/35 bg-paper-raised/85 px-2.5 py-1 text-xs tracking-[0.12em] text-ink-soft shadow-[0_2px_10px_var(--shadow-warm)] transition hover:border-gilt/70 hover:text-gilt"
        >
          ← 主菜单
        </Link>
        <div className="pointer-events-auto min-w-0 px-3 text-center">
          <span
            className="block truncate text-sm tracking-[0.18em] text-ink-soft"
            style={{
              fontFamily: "var(--font-display)",
              textShadow: "0 0 10px var(--gilt-glow)",
            }}
            title={`${worldName} · ${era} · ${time}`}
          >
            {worldName} · {era} · {time}
          </span>
          <span
            aria-hidden="true"
            className="mx-auto mt-1 block h-px w-3/4 max-w-md bg-gradient-to-r from-transparent via-gilt/60 to-transparent"
          />
        </div>
        {/* 与左端按钮近等宽的配衡占位，保持章题居中 */}
        <span aria-hidden="true" className="w-[4.75rem]" />
      </div>
    </header>
  );
}
