import packageJson from "../../../package.json";

export function GameVersion() {
  const version = `v${packageJson.version}`;

  return (
    <small className="game-version" aria-label={`游戏版本 ${packageJson.version}`}>
      {version}
    </small>
  );
}
