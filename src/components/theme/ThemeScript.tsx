/**
 * 主题闪烁抑制：在首帧前从 localStorage 恢复日卷/烛光模式。
 * prefs.candleMode: "day" | "candle" | "auto"（auto 按本地时间 19:00–7:00 燃烛）
 */
export function ThemeScript() {
  const code = `
(function () {
  try {
    var mode = localStorage.getItem("genesis:theme") || "day";
    var candle = mode === "candle";
    if (mode === "auto") {
      var h = new Date().getHours();
      candle = h >= 19 || h < 7;
    }
    if (candle) document.documentElement.dataset.theme = "candle";
  } catch (e) {}
})();
`;
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}
