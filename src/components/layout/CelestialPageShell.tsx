import type { ReactNode } from "react";
import { PlayBackground } from "@/components/play/PlayBackground";

export function CelestialPageShell({
  children,
  contentClassName = "",
}: {
  children: ReactNode;
  contentClassName?: string;
}) {
  return (
    <main className="play-shell min-h-screen px-4 py-6 sm:px-6 sm:py-10">
      <PlayBackground variant="supporting" />
      <div className={`celestial-page-content min-w-0 ${contentClassName}`.trim()}>
        {children}
      </div>
    </main>
  );
}
