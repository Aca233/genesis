import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 2C2G 部署:自包含产物(.next/standalone),配合 deploy/build-and-ship.sh 使用。
  // 对 `next dev` 无影响;`next build` 额外产出 standalone 目录。见 deploy/README.md。
  output: "standalone",
  // 全量 @iconify-json 集合(合计约 14MB JSON)不打进服务端路由包:
  // 运行时正常只读构建期子集 src/lib/icons/icon-subset.generated.json,
  // 仅当子集缺失(目录漂移)时由 svg.server.ts 经 createRequire 按需外置加载。
  serverExternalPackages: [
    "@iconify-json/ph",
    "@iconify-json/tabler",
    "@iconify-json/icon-park-outline",
    "@iconify-json/game-icons",
  ],
};

export default nextConfig;
