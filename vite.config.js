import { defineConfig } from 'vite';

/**
 * 書き出しはブラウザ内(web/export.js)で完結するため、サーバ側の処理は無い。
 * 以前は開発サーバに書き出し用のエンドポイントを置いていたが、
 * 静的ホスティングで動かせないうえ、別オリジンから叩けるCSRFの入口にもなるため廃止した。
 */
export default defineConfig({
  root: 'web',
  // GitHub Pages はリポジトリ名のサブパスで配信されるため、
  // 本番ビルドだけ base を付ける(ローカルの `npm run dev` は素のルート)。
  base: process.env.GITHUB_ACTIONS ? '/map-route-anim/' : '/',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: { port: 5180, open: true },
});
