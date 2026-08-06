import { defineConfig } from 'vite';
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

/** Origin ヘッダが自分自身を指しているか。 */
function isSameOrigin(origin, host) {
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * GUIの「書き出し」ボタンから scripts/render.mjs を叩くための開発サーバ拡張。
 *
 * 書き出し処理そのものはCLIと完全に同じスクリプトを呼ぶ。
 * ここに描画やエンコードのロジックを持たせないこと。
 */
function renderEndpoint() {
  // 書き出しは同時に1本だけ。連打や自動リクエストでプロセスが積み上がるのを防ぐ。
  // 一時ファイル(_render.json)を共有しているので、並走させると
  // 別のリクエストの内容で書き出してしまう競合も起きる。
  let busy = false;

  return {
    name: 'render-endpoint',
    configureServer(server) {
      server.middlewares.use('/api/render', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          return res.end('POST only');
        }

        // 開発サーバがlocalhostに待ち受けている間、利用者が別の悪意あるページを
        // 開くと、そのページから本エンドポイントを叩けてしまう(CSRF)。
        // レスポンスは読めなくても、書き出しの実行という副作用は起きる。
        // 対策として (1) 別オリジンからのリクエストを拒否し、
        // (2) application/json を必須にして単純リクエストを成立させない。
        const origin = req.headers.origin;
        if (origin && !isSameOrigin(origin, req.headers.host)) {
          res.statusCode = 403;
          return res.end(JSON.stringify({ error: '別オリジンからの要求は拒否しました' }));
        }
        if (!String(req.headers['content-type'] ?? '').includes('application/json')) {
          res.statusCode = 415;
          return res.end(JSON.stringify({ error: 'content-type は application/json のみ' }));
        }

        let body = '';
        let tooLarge = false;
        req.on('data', (c) => {
          body += c;
          // 巨大なJSONでメモリを食い潰されないようにする
          if (body.length > 5_000_000) {
            tooLarge = true;
            req.destroy();
          }
        });
        req.on('end', () => {
          if (tooLarge) {
            res.statusCode = 413;
            return res.end(JSON.stringify({ error: 'プロジェクトが大きすぎます' }));
          }
          let project;
          try {
            project = JSON.parse(body);
          } catch {
            res.statusCode = 400;
            return res.end(JSON.stringify({ error: 'プロジェクトのJSONが不正です' }));
          }

          if (busy) {
            res.statusCode = 429;
            return res.end(JSON.stringify({ error: '書き出し中です。完了までお待ちください' }));
          }
          busy = true;

          mkdirSync(join(root, 'out'), { recursive: true });
          const jsonPath = join(root, 'out', '_render.json');
          writeFileSync(jsonPath, JSON.stringify(project, null, 2));

          const stamp = new Date()
            .toISOString()
            .replace(/[-:T]/g, '')
            .slice(0, 14);
          const outPath = join(root, 'out', `route-${stamp}.mp4`);

          const child = spawn(
            process.execPath,
            [join(root, 'scripts', 'render.mjs'), jsonPath, '-o', outPath],
            { cwd: root }
          );

          let log = '';
          let settled = false;
          child.stdout.on('data', (d) => (log += d));
          child.stderr.on('data', (d) => (log += d));

          // spawn自体が失敗した場合 close が来ないことがある。
          // ここで解放しないと busy が立ったままエンドポイントが固まる。
          child.on('error', (err) => {
            if (settled) return;
            settled = true;
            busy = false;
            res.statusCode = 500;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: false, log: `起動に失敗しました: ${err.message}` }));
          });
          child.on('close', (code) => {
            if (settled) return;
            settled = true;
            busy = false;
            res.setHeader('content-type', 'application/json');
            if (code === 0) {
              res.end(JSON.stringify({ ok: true, path: outPath }));
            } else {
              res.statusCode = 500;
              res.end(JSON.stringify({ ok: false, log: log.slice(-2000) }));
            }
          });
        });
      });
    },
  };
}

export default defineConfig({
  root: 'web',
  server: { port: 5180, open: true },
  plugins: [renderEndpoint()],
});
