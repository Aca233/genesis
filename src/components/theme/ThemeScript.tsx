/**
 * 主题闪烁抑制：在首帧前从 localStorage 恢复日卷/烛光模式。
 * prefs.candleMode: "day" | "candle" | "auto"（auto 按本地时间 19:00–7:00 燃烛）
 *
 * theme-color 字面量取双主题 --paper 值（#f3ead8 日卷 / #2b241c 烛光）；
 * 内联脚本无法 import，与 useTheme.ts 的 syncThemeColor 各自独立维护、互为镜像。
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
    var meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", "theme-color");
      document.head.appendChild(meta);
    }
    meta.setAttribute("content", candle ? "#2b241c" : "#f3ead8");
  } catch (e) {}
})();
`;
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}
