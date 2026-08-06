import topo from 'world-atlas/countries-50m.json';

import { buildWorld } from '../src/core/world.js';
import {
  prepareScene,
  cacheBasemap,
  drawFrameAtProgress,
  pointScreenPos,
} from '../src/core/draw.js';
import { createProject, sampleProject } from '../src/core/project.js';
import { exportMp4, downloadBlob, canExportInBrowser } from './export.js';
import { labelStyles } from '../src/core/style.js';
import { projections } from '../src/core/geo.js';
import { easings, progressAt } from '../src/core/timeline.js';

const world = buildWorld(topo);

/**
 * プレビューは書き出しと同じ drawFrameAtProgress を呼ぶ。
 * 解像度だけが違い、描画コードは1本しかない。
 */

const RESOLUTIONS = {
  '1920x1080': { width: 1920, height: 1080, label: '1920×1080 (16:9)' },
  '3840x2160': { width: 3840, height: 2160, label: '3840×2160 (4K)' },
  '1080x1920': { width: 1080, height: 1920, label: '1080×1920 (9:16)' },
  '1080x1080': { width: 1080, height: 1080, label: '1080×1080 (1:1)' },
};

/** プレビューの長辺の上限。ここを超えない範囲で出力と同じ比率にする。 */
const PREVIEW_MAX = 960;

const el = (id) => document.getElementById(id);
const canvas = el('preview');
const ctx = canvas.getContext('2d');

let project = sampleProject();
let scene = null;
let playing = false;
let playStart = 0;
let progress = 0;
let drag = null;

// --- 書体をブラウザ側でも同じ family 名で解決させる ---
await Promise.all(
  Object.values(labelStyles).map(async (s) => {
    try {
      const face = new FontFace(s.family, `local("${s.localName}")`);
      await face.load();
      document.fonts.add(face);
    } catch {
      console.warn(`書体を読み込めませんでした: ${s.localName}`);
    }
  })
);

// --- 選択肢の生成 ---
// 配色・書体・地点アイコンはGUIから外して固定にしている(project.js の既定値)。
// 変えられるのは差し色だけ。
fillSelect('projection', Object.entries(projections).map(([k, v]) => [k, v.label]));
fillSelect('easing', Object.keys(easings).map((k) => [k, k]));
fillSelect('resolution', Object.entries(RESOLUTIONS).map(([k, v]) => [k, v.label]));

function fillSelect(id, pairs) {
  el(id).innerHTML = pairs
    .map(([v, t]) => `<option value="${v}">${t}</option>`)
    .join('');
}

/** よく使う差し色。地図が淡色なので、彩度のある色ならだいたい成立する。 */
const ACCENTS = ['#e0553f', '#e08a1e', '#2f8f6b', '#1f4e79', '#7a4ea8', '#22282d'];

const swatches = el('accent-swatches');
ACCENTS.forEach((color) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.style.background = color;
  b.title = color;
  b.addEventListener('click', () => {
    project.accentColor = color;
    syncControls();
    rebuild({ keepView: true });
  });
  swatches.append(b);
});

// --- 状態をUIへ ---
function syncControls() {
  el('projection').value = project.projection;
  el('accent').value = project.accentColor;
  el('showLabels').checked = project.showLabels;
  el('showGraticule').checked = project.showGraticule;
  el('showFutureRoute').checked = project.showFutureRoute;
  el('duration').value = project.duration;
  el('holdStart').value = project.holdStart;
  el('holdEnd').value = project.holdEnd;
  el('easing').value = project.easing;
  el('fps').value = project.output.fps;
  el('resolution').value = `${project.output.width}x${project.output.height}`;

  const pad = project.paddingPct ?? defaultPadding();
  el('padding').value = pad;
  el('paddingOut').value = `${pad}%`;
}

function defaultPadding() {
  const clipped = project.projection === 'orthographic';
  const fitMode = project.fitMode ?? (clipped ? 'globe' : 'route');
  return fitMode === 'globe' ? 4 : 12;
}

// --- 地点リスト ---
function renderPoints() {
  const list = el('points');
  el('points-empty').style.display = project.points.length ? 'none' : 'block';
  list.innerHTML = '';

  project.points.forEach((pt, i) => {
    const li = document.createElement('li');

    const idx = document.createElement('span');
    idx.className = 'idx';
    idx.textContent = i + 1;

    const name = document.createElement('input');
    name.type = 'text';
    name.value = pt.name ?? '';
    name.addEventListener('input', () => {
      pt.name = name.value;
      rebuild({ keepView: true });
    });

    const up = iconButton('↑', () => movePoint(i, -1), i === 0);
    const down = iconButton('↓', () => movePoint(i, 1), i === project.points.length - 1);
    const del = iconButton('×', () => removePoint(i), false);

    li.append(idx, name, up, down, del);
    list.append(li);
  });
}

function iconButton(text, onClick, disabled) {
  const b = document.createElement('button');
  b.textContent = text;
  b.disabled = disabled;
  b.addEventListener('click', onClick);
  return b;
}

function movePoint(i, dir) {
  const j = i + dir;
  if (j < 0 || j >= project.points.length) return;
  const [pt] = project.points.splice(i, 1);
  project.points.splice(j, 0, pt);
  renderPoints();
  rebuild();
}

function removePoint(i) {
  project.points.splice(i, 1);
  renderPoints();
  rebuild();
}

// --- 再構築と描画 ---
function rebuild({ keepView = false } = {}) {
  const { width, height } = project.output;
  const k = Math.min(1, PREVIEW_MAX / Math.max(width, height));
  const pw = Math.round(width * k);
  const ph = Math.round(height * k);

  const sizeChanged = canvas.width !== pw || canvas.height !== ph;
  if (sizeChanged) {
    canvas.width = pw;
    canvas.height = ph;
  }

  const reuse = keepView && !sizeChanged && scene ? scene : null;
  scene = prepareScene(project, world, { width: pw, height: ph, reuse });

  // 地図は再生中もドラッグ中も変わらないので、一度だけ焼いて貼り回す
  if (!scene.basemap) {
    cacheBasemap(scene, (w, h) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      return c;
    });
  }
  draw();
}

function draw() {
  if (!scene) return;
  if (project.points.length < 2) {
    // 経路が引けないので地図だけ見せる
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (scene.basemap) ctx.drawImage(scene.basemap, 0, 0);
    drawBarePins();
  } else {
    drawFrameAtProgress(ctx, scene, progress);
  }
  el('scrub').value = Math.round(progress * 1000);
  el('time').textContent = `${(progress * project.duration).toFixed(1)}s`;
}

/** 地点が1つ以下で経路が無いときでも、置いたピンは見えるようにする。 */
function drawBarePins() {
  project.points.forEach((pt) => {
    const pos = pointScreenPos(scene, pt.coord);
    if (!pos || !pos.visible) return;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 5 * scene.scale, 0, Math.PI * 2);
    ctx.fillStyle = scene.palette.pin;
    ctx.fill();
    ctx.lineWidth = 2 * scene.scale;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
  });
}

// --- 再生 ---
function tick(now) {
  if (!playing) return;
  const elapsed = (now - playStart) / 1000;
  if (elapsed >= project.duration) {
    progress = 1;
    stop();
    draw();
    return;
  }
  progress = progressAt(elapsed, project);
  draw();
  requestAnimationFrame(tick);
}

function play() {
  if (project.points.length < 2) return;
  playing = true;
  el('play').textContent = '停止';
  playStart = performance.now();
  requestAnimationFrame(tick);
}

function stop() {
  playing = false;
  el('play').textContent = '再生';
}

el('play').addEventListener('click', () => (playing ? stop() : play()));

el('scrub').addEventListener('input', (e) => {
  stop();
  progress = Number(e.target.value) / 1000;
  draw();
});

// --- キャンバス操作 ---
function toCanvas(e) {
  const r = canvas.getBoundingClientRect();
  return {
    x: ((e.clientX - r.left) / r.width) * canvas.width,
    y: ((e.clientY - r.top) / r.height) * canvas.height,
  };
}

/** 掴めるピンを探す。ピンの頭と先端の両方を当たり判定にする。 */
function hitPoint(pos) {
  const k = scene.scale;
  for (let i = project.points.length - 1; i >= 0; i--) {
    const p = pointScreenPos(scene, project.points[i].coord);
    if (!p || !p.visible) continue;
    const head = Math.hypot(pos.x - p.x, pos.y - p.headY);
    const tip = Math.hypot(pos.x - p.x, pos.y - p.y);
    if (head < 13 * k || tip < 9 * k) return i;
  }
  return -1;
}

/** 画面座標を緯度経度へ。地球儀の外側をクリックした場合は null。 */
function toCoord(pos) {
  const coord = scene.projection.invert?.([pos.x, pos.y]);
  if (!coord || !Number.isFinite(coord[0]) || !Number.isFinite(coord[1])) return null;
  // 投影し直して戻ってこない点(球の外側など)は無効とみなす
  const back = scene.projection(coord);
  if (!back || Math.hypot(back[0] - pos.x, back[1] - pos.y) > 1) return null;
  return coord;
}

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || !scene) return;
  const pos = toCanvas(e);
  const hit = hitPoint(pos);
  if (hit >= 0) {
    drag = { index: hit, moved: false };
    canvas.setPointerCapture(e.pointerId);
  } else {
    drag = { index: -1, moved: false, start: pos };
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (!drag || drag.index < 0) return;
  const coord = toCoord(toCanvas(e));
  if (!coord) return;
  drag.moved = true;
  project.points[drag.index].coord = coord;
  // ドラッグ中は投影を固定する。動かすたびに再フィットすると地図が揺れて狙えない
  rebuild({ keepView: true });
});

canvas.addEventListener('pointerup', (e) => {
  if (!drag) return;
  const pos = toCanvas(e);

  if (drag.index >= 0) {
    // 離したところで初めて全体に合わせ直す
    if (drag.moved) rebuild();
  } else if (Math.hypot(pos.x - drag.start.x, pos.y - drag.start.y) < 4) {
    const coord = toCoord(pos);
    if (coord) {
      project.points.push({
        id: Math.random().toString(36).slice(2, 10),
        name: `Point ${project.points.length + 1}`,
        coord,
      });
      renderPoints();
      rebuild();
    }
  }
  drag = null;
});

canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (!scene) return;
  const hit = hitPoint(toCanvas(e));
  if (hit >= 0) removePoint(hit);
});

// --- コントロール ---
function bind(id, apply, { rebuildView = true } = {}) {
  el(id).addEventListener('input', () => {
    apply();
    syncControls();
    rebuild({ keepView: !rebuildView });
  });
}

bind('projection', () => {
  project.projection = el('projection').value;
  // 投影を変えたら余白の既定値も変わるので、明示指定を捨てる
  project.paddingPct = null;
});
bind('accent', () => (project.accentColor = el('accent').value), { rebuildView: false });
bind('showLabels', () => (project.showLabels = el('showLabels').checked), { rebuildView: false });
bind('showGraticule', () => (project.showGraticule = el('showGraticule').checked));
bind('showFutureRoute', () => (project.showFutureRoute = el('showFutureRoute').checked), { rebuildView: false });
bind('padding', () => (project.paddingPct = Number(el('padding').value)));
bind('duration', () => (project.duration = Number(el('duration').value)), { rebuildView: false });
bind('holdStart', () => (project.holdStart = Number(el('holdStart').value)), { rebuildView: false });
bind('holdEnd', () => (project.holdEnd = Number(el('holdEnd').value)), { rebuildView: false });
bind('easing', () => (project.easing = el('easing').value), { rebuildView: false });
bind('fps', () => (project.output.fps = Number(el('fps').value)), { rebuildView: false });
bind('resolution', () => {
  const r = RESOLUTIONS[el('resolution').value];
  project.output.width = r.width;
  project.output.height = r.height;
});

// --- 書き出し ---
// サーバを使わずブラウザ内で完結させる。静的ホスティング(GitHub Pages)でも
// そのまま動き、ローカルでもNodeやffmpegを必要としない。
if (!canExportInBrowser()) {
  el('render').disabled = true;
  el('render-status').textContent =
    'このブラウザは書き出しに未対応です(Chrome / Edge / Safari 16.4以降で利用できます)';
}

el('render').addEventListener('click', async () => {
  if (project.points.length < 2) {
    el('render-status').textContent = '地点を2つ以上置いてください';
    return;
  }
  const button = el('render');
  const status = el('render-status');
  stop();
  button.disabled = true;

  const started = performance.now();
  try {
    const blob = await exportMp4(project, world, (done, total) => {
      status.textContent = `書き出し中 ${Math.round((done / total) * 100)}%`;
    });
    const name = project.points
      .map((p) => (p.name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-'))
      .filter(Boolean)
      .join('-') || 'route';
    downloadBlob(blob, `${name}.mp4`);
    const secs = ((performance.now() - started) / 1000).toFixed(1);
    status.textContent = `完了(${secs}秒 / ${(blob.size / 1e6).toFixed(1)}MB)`;
  } catch (err) {
    status.textContent = `失敗: ${err.message}`;
  } finally {
    button.disabled = false;
  }
});

// --- 保存・読込 ---
el('save').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'route.json';
  a.click();
  URL.revokeObjectURL(a.href);
});

el('load').addEventListener('click', () => el('file').click());

el('file').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    project = { ...createProject(), ...JSON.parse(await file.text()) };
    progress = 0;
    syncControls();
    renderPoints();
    rebuild();
  } catch (err) {
    alert(`読み込めませんでした: ${err.message}`);
  }
  e.target.value = '';
});

// --- 起動 ---
syncControls();
renderPoints();
rebuild();
