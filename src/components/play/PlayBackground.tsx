export function PlayBackground({
  variant = "play",
}: {
  variant?: "play" | "home" | "supporting" | "genesis" | "progress" | "ceremony";
}) {
  const className = [
    "play-background",
    variant !== "play" && `play-background--${variant}`,
  ].filter(Boolean).join(" ");

  return <div className={className} aria-hidden="true" />;
}
