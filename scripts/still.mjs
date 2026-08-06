/**
 * 見た目の方向性を確認するための静止画出力。
 * 投影法・パレット・書体の組み合わせを一括で out/ に書き出す。
 */
import { createCanvas } from '@napi-rs/canvas';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { buildWorld } from '../src/core/world.js';
import { prepareScene, drawFrameAtProgress } from '../src/core/draw.js';
import { registerLabelFonts } from '../src/node/fonts.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

registerLabelFonts();

const topo = JSON.parse(
  readFileSync(join(root, 'node_modules/world-atlas/countries-50m.json'), 'utf8')
);
const world = buildWorld(topo);

const P = {
  tokyo: { name: 'Tokyo', coord: [139.6917, 35.6895] },
  london: { name: 'London', coord: [-0.1276, 51.5072] },
  dubai: { name: 'Dubai', coord: [55.2708, 25.2048] },
  naha: { name: 'Naha', coord: [127.6809, 26.2124] },
  losangeles: { name: 'Los Angeles', coord: [-118.2437, 34.0522] },
};

const base = {
  showGraticule: false,
  showLabels: true,
  showFutureRoute: false,
  palette: 'paleSoft',
  labelStyle: 'avenir',
  pinStyle: 'pin',
  duration: 12,
  holdStart: 1,
  holdEnd: 1.5,
};

const trio = [P.tokyo, P.dubai, P.london];

const variants = [
  // --- 線の強さ比較(同じ絵で海岸線・国境の濃さだけ変える) ---
  { file: 'line-1-soft', projection: 'naturalEarth', points: trio, palette: 'paleSoft', showGraticule: false },
  { file: 'line-2-medium', projection: 'naturalEarth', points: trio, palette: 'paleMedium', showGraticule: false },
  { file: 'line-3-strong', projection: 'naturalEarth', points: trio, palette: 'paleStrong', showGraticule: false },

  // --- 線の強さ比較(地球儀) ---
  { file: 'globe-1-soft', projection: 'orthographic', points: trio, palette: 'paleSoft' },
  { file: 'globe-2-medium', projection: 'orthographic', points: trio, palette: 'paleMedium' },
  { file: 'globe-3-strong', projection: 'orthographic', points: trio, palette: 'paleStrong' },

  // --- 経路のパターン ---
  { file: 'route-1-tokyo-london', projection: 'naturalEarth', points: [P.tokyo, P.london], showGraticule: false },
  { file: 'route-2-pacific', projection: 'naturalEarth', points: [P.tokyo, P.losangeles], showGraticule: false },
  { file: 'route-3-tokyo-naha', projection: 'naturalEarth', points: [P.tokyo, P.naha], showGraticule: false },

  // --- 参考: 地球の絵風にも海岸線を入れた版 ---
  { file: 'ref-earth-globe', projection: 'orthographic', points: trio, palette: 'earth' },
];

const W = 1280;
const H = 720;

for (const v of variants) {
  const project = { ...base, ...v };
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const scene = prepareScene(project, world, { width: W, height: H });
  drawFrameAtProgress(ctx, scene, 0.62);
  writeFileSync(join(root, 'out', `${v.file}.png`), canvas.toBuffer('image/png'));
  console.log('wrote', v.file);
}
