"use client";

import Image from "next/image";
import { useState } from "react";
import type { WorldMode } from "@/lib/world-mode";

const MODE_LAYERS: ReadonlyArray<{
  mode: WorldMode;
  src: string;
}> = [
  {
    mode: "pantheon",
    src: "/images/backgrounds/genesis-mode-pantheon.webp",
  },
  {
    mode: "creator",
    src: "/images/backgrounds/genesis-mode-creator.webp",
  },
];

export function GenesisModeBackground({ mode }: { mode: WorldMode }) {
  const [failed, setFailed] = useState<Record<WorldMode, boolean>>({
    pantheon: false,
    creator: false,
  });

  return (
    <div
      className={`genesis-mode-background genesis-mode-background--${mode}`}
      aria-hidden="true"
    >
      {MODE_LAYERS.map((layer) => (
        !failed[layer.mode] && (
          <Image
            key={layer.mode}
            src={layer.src}
            alt=""
            fill
            sizes="100vw"
            preload
            className={[
              "genesis-mode-background__image",
              `genesis-mode-background__image--${layer.mode}`,
              mode === layer.mode && "is-active",
            ].filter(Boolean).join(" ")}
            onError={() => {
              setFailed((current) => (
                current[layer.mode]
                  ? current
                  : { ...current, [layer.mode]: true }
              ));
            }}
          />
        )
      ))}
    </div>
  );
}
