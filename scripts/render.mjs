/**
 * MP4書き出し。
 *
 * プレビュー(ブラウザ)と同じ src/core/draw.js の drawFrame をそのまま呼ぶ。
 * ここに描画ロジックを書かないこと。書いた時点でプレビューとズレ始める。
 *
 *   node scripts/render.mjs [project.json] [-o out/route.mp4]
 */
import { createCanvas } from '@napi-rs/canvas';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { buildWorld } from '../src/core/world.js';
import { prepareScene, drawFrame, cacheBasemap } from '../src/core/draw.js';
import { frameCount } from '../src/core/timeline.js';
import { sampleProject, sanitizeProject } from '../src/core/project.js';
import { registerLabelFonts } from '../src/node/fonts.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

registerLabelFonts();

// --- 引数 ---
const args = process.argv.slice(2);
const outIndex = args.findIndex((a) => a === '-o' || a === '--out');
const outPath = outIndex >= 0 ? resolve(args[outIndex + 1]) : join(root, 'out', 'route.mp4');
const projectPath = args.find((a) => a.endsWith('.json'));

// 外部から渡ったJSONをそのまま信用しない。とくに detail は
// 下のファイルパスに埋まるため、既知の値だけに絞る必要がある。
const project = sanitizeProject(
  projectPath && existsSync(projectPath)
    ? JSON.parse(readFileSync(projectPath, 'utf8'))
    : sampleProject()
);

const { width, height, fps } = project.output;

const topo = JSON.parse(
  readFileSync(join(root, 'node_modules/world-atlas', `countries-${project.detail}.json`), 'utf8')
);
const world = buildWorld(topo);

const canvas = createCanvas(width, height);
const ctx = canvas.getContext('2d');
// 地図は全フレーム共通なので一度だけ焼く
const scene = cacheBasemap(
  prepareScene(project, world, { width, height }),
  createCanvas
);

const total = frameCount({ duration: project.duration, fps });

const ffmpeg = spawn('ffmpeg', [
  '-y',
  '-f', 'rawvideo',
  '-pix_fmt', 'rgba',
  '-s', `${width}x${height}`,
  '-r', String(fps),
  '-i', 'pipe:0',
  '-an',
  '-c:v', 'libx264',
  '-profile:v', 'high',
  '-preset', 'slow',
  '-crf', '17',
  // DaVinci Resolve が読める不透過MP4にする
  '-pix_fmt', 'yuv420p',
  '-movflags', '+faststart',
  outPath,
], { stdio: ['pipe', 'inherit', 'inherit'] });

ffmpeg.on('error', (err) => {
  console.error('ffmpegの起動に失敗しました:', err.message);
  process.exit(1);
});

const started = Date.now();

for (let i = 0; i < total; i++) {
  const t = i / fps;
  drawFrame(ctx, scene, t);
  const buf = Buffer.from(ctx.getImageData(0, 0, width, height).data.buffer);
  if (!ffmpeg.stdin.write(buf)) {
    await new Promise((r) => ffmpeg.stdin.once('drain', r));
  }
  if (i % 30 === 0) {
    process.stdout.write(`\rrendering ${i + 1}/${total}`);
  }
}
ffmpeg.stdin.end();

await new Promise((r) => ffmpeg.on('close', r));

const secs = ((Date.now() - started) / 1000).toFixed(1);
console.log(`\n${total}フレームを${secs}秒で書き出しました -> ${outPath}`);
