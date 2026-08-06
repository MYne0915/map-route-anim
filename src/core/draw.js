import { buildProjection, makePath, graticule, SPHERE } from './geo.js';
import { buildLegs, routeGeoJSON, totalDistance, clamp01 } from './arc.js';
import { progressAt, pointReveal } from './timeline.js';
import { palettes, defaultPalette, labelStyles, defaultLabelStyle } from './style.js';

/**
 * このファイルがプロジェクト唯一のレンダラ。
 * ブラウザのcanvas(プレビュー)とNodeの@napi-rs/canvas(書き出し)の
 * 両方から同じ関数を呼ぶため、Canvas 2D の範囲だけで書く。
 * DOM・ブラウザ固有APIをここに持ち込まないこと。
 */

/** 投影法ごとの弧の持ち上げ量の既定値。 */
const DEFAULT_LIFT = {
  // 正射図法では大円が視点の中心を通るため画面上で直線に退化する。
  // 弧に見せるには画面空間で持ち上げる必要がある。
  orthographic: 0.16,
  // 平面図法は大円がそのまま曲線として出るので持ち上げない。
  naturalEarth: 0,
  equirectangular: 0,
  mercator: 0,
};

/**
 * 毎フレーム変わらない準備をまとめて済ませる。
 * 投影のフィットと経路の画面座標化はここで一度だけ行うので、
 * 再生中は配列を切って描くだけになり、拡大率も揺れない。
 */
export function prepareScene(project, world, { width, height, reuse = null }) {
  const legs = buildLegs(project.points);
  const route = routeGeoJSON(legs);
  const kind = project.projection ?? 'naturalEarth';
  const clipped = kind === 'orthographic';

  // 地点が2つ未満だと経路が空になる。空のGeoJSONにフィットさせると
  // 境界が無限大になり、拡大率がNaNになって画面が真っ白になるため、
  // 経路が引けないうちは球(=世界全体)にフィットさせる。
  const hasRoute = legs.length > 0;

  // 地球儀は球全体が見えないと地球儀に見えないため、既定で球にフィットさせる。
  // 球は丸いので短辺で決まり、余白を大きく取ると画面が余りすぎる。
  const fitMode = !hasRoute ? 'globe' : project.fitMode ?? (clipped ? 'globe' : 'route');

  // reuse が渡されたら投影を作り直さない。
  // ピンをドラッグしている最中に毎フレーム再フィットすると画面が揺れるうえ、
  // 投影が変わると地図のキャッシュも捨てることになり重い。
  const projection =
    reuse?.projection ??
    buildProjection({
      kind,
      width,
      height,
      paddingPct: project.paddingPct ?? (fitMode === 'globe' ? 4 : 12),
      fitMode,
      route,
      // 経路が無いと重心も出せないので、置かれている地点があればそこを向く
      rotate: hasRoute ? null : project.points[0]?.coord ?? [0, 0],
    });

  const lift = project.arcLift ?? DEFAULT_LIFT[kind] ?? 0;
  const geometry = buildScreenGeometry(projection, legs, lift, clipped);

  return {
    width,
    height,
    project,
    world,
    legs,
    route,
    projection,
    clipped,
    geometry,
    // 投影を使い回した場合だけ地図のキャッシュも引き継げる
    basemap: reuse?.projection ? reuse.basemap : null,
    palette: withAccent(palettes[project.palette] ?? defaultPalette, project.accentColor),
    labelStyle: labelStyles[project.labelStyle] ?? labelStyles[defaultLabelStyle],
    // 解像度に応じて線の太さや文字を拡大する。プレビュー(低解像度)と
    // 書き出し(高解像度)で見た目の比率を揃えるための係数。
    scale: Math.min(width, height) / 720,
  };
}

/**
 * 差し色だけをパレットに差し替える。
 * 地図側(陸・海・国境)の配色は固定で、経路と飛行機の色だけ変えられる。
 */
function withAccent(palette, accent) {
  if (!accent) return palette;
  return { ...palette, route: accent, marker: accent };
}

/**
 * 経路を画面座標の点列に変換する。
 *
 * 弧の持ち上げは投影後の画面空間で行う。地理的な経路(大円)は正しいまま、
 * 見た目にだけ弧を与えられるので、どの投影法でも破綻しない。
 */
function buildScreenGeometry(projection, legs, lift, clipped) {
  const total = totalDistance(legs);
  const pts = [];
  const legStart = [];
  let acc = 0;

  for (const leg of legs) {
    legStart.push(total === 0 ? 0 : acc / total);

    const a = projection(leg.points[0]);
    const b = projection(leg.points[leg.points.length - 1]);
    let nx = 0;
    let ny = 0;
    let chord = 0;
    if (a && b) {
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      chord = Math.hypot(dx, dy);
      if (chord > 0) {
        // 進行方向の法線。画面上で上へ膨らむ側を選ぶ(下向きに垂れると不格好)
        nx = -dy / chord;
        ny = dx / chord;
        if (ny > 0) {
          nx = -nx;
          ny = -ny;
        }
      }
    }

    const n = leg.points.length;
    for (let j = 0; j < n; j++) {
      const u = j / (n - 1);
      const coord = leg.points[j];
      const xy = projection(coord);
      const visible = xy != null && (!clipped || isFrontSide(projection, coord));
      const offset = Math.sin(Math.PI * u) * lift * chord;
      pts.push({
        x: xy ? xy[0] + nx * offset : 0,
        y: xy ? xy[1] + ny * offset : 0,
        visible,
        frac: total === 0 ? u : (acc + u * leg.dist) / total,
      });
    }
    acc += leg.dist;
  }

  return { pts, legStart };
}

/** 進捗 p までの点列と、その先端を返す。 */
function sliceAt(geometry, p) {
  const { pts } = geometry;
  const taken = [];
  let head = null;

  for (let i = 0; i < pts.length; i++) {
    if (pts[i].frac <= p) {
      taken.push(pts[i]);
      continue;
    }
    // p が点と点の間にあるので補間して先端を作る
    const prev = pts[i - 1];
    if (prev) {
      const span = pts[i].frac - prev.frac;
      const w = span === 0 ? 0 : (p - prev.frac) / span;
      head = {
        x: prev.x + (pts[i].x - prev.x) * w,
        y: prev.y + (pts[i].y - prev.y) * w,
        visible: prev.visible && pts[i].visible,
        frac: p,
      };
      taken.push(head);
    }
    break;
  }

  if (!head && taken.length) head = taken[taken.length - 1];
  return { taken, head };
}

/** 可視な点が連続する区間ごとに分割する(地球儀の裏側で線を切るため)。 */
function visibleRuns(points) {
  const runs = [];
  let run = [];
  for (const pt of points) {
    if (pt.visible) {
      run.push(pt);
    } else if (run.length) {
      runs.push(run);
      run = [];
    }
  }
  if (run.length) runs.push(run);
  return runs;
}

function strokeRuns(ctx, runs) {
  ctx.beginPath();
  for (const run of runs) {
    if (run.length < 2) continue;
    ctx.moveTo(run[0].x, run[0].y);
    for (let i = 1; i < run.length; i++) ctx.lineTo(run[i].x, run[i].y);
  }
  ctx.stroke();
}

/**
 * 地図をオフスクリーンに焼いて scene に持たせる。
 *
 * createCanvas は環境ごとに渡す(ブラウザは document.createElement、
 * Nodeは @napi-rs/canvas の createCanvas)。ここだけが環境依存なので、
 * 呼び出し側から注入してレンダラ本体を環境非依存に保つ。
 */
export function cacheBasemap(scene, createCanvas) {
  const canvas = createCanvas(scene.width, scene.height);
  const ctx = canvas.getContext('2d');
  drawBasemap(ctx, scene);
  scene.basemap = canvas;
  return scene;
}

/** 時刻 t(秒)のフレームを描く。 */
export function drawFrame(ctx, scene, t) {
  drawFrameAtProgress(ctx, scene, progressAt(t, scene.project));
}

/** 進捗 p(0..1)を直接指定して描く。静止画の確認やスクラブに使う。 */
export function drawFrameAtProgress(ctx, scene, p) {
  ctx.save();
  ctx.clearRect(0, 0, scene.width, scene.height);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // 地図は再生中に変化しないので、キャッシュがあれば貼るだけで済ませる。
  // ここが1フレームあたりの処理時間の大半を占めるため、
  // プレビューが実時間で動くかどうかはこのキャッシュに懸かっている。
  if (scene.basemap) {
    ctx.drawImage(scene.basemap, 0, 0, scene.width, scene.height);
  } else {
    drawBasemap(ctx, scene);
  }

  drawOverlay(ctx, scene, p);
  ctx.restore();
}

/**
 * 地図(背景・経緯線・陸・国境・海岸線)を描く。
 * 投影が変わらない限り結果は同じなので、キャッシュ対象になる。
 */
export function drawBasemap(ctx, scene) {
  const { width, height, palette, projection, world, project, clipped } = scene;
  const path = makePath(projection, ctx);
  const k = scene.scale;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // --- 背景 ---
  if (clipped) {
    // 地球儀は白地に円盤が浮かぶ構図にする
    ctx.fillStyle = palette.backdrop ?? '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.beginPath();
    path(SPHERE);
    ctx.fillStyle = palette.ocean;
    ctx.fill();
  } else {
    ctx.fillStyle = palette.ocean;
    ctx.fillRect(0, 0, width, height);
  }

  // --- 経緯線 ---
  if (project.showGraticule) {
    ctx.beginPath();
    path(graticule());
    ctx.strokeStyle = palette.graticule;
    ctx.lineWidth = 0.6 * k;
    ctx.stroke();
  }

  // --- 陸 ---
  ctx.beginPath();
  path(world.land);
  ctx.fillStyle = palette.land;
  ctx.fill();

  // --- 国境 ---
  if (world.borders) {
    ctx.beginPath();
    path(world.borders);
    ctx.strokeStyle = palette.border;
    ctx.lineWidth = 0.8 * k;
    ctx.stroke();
  }

  // --- 海岸線 ---
  // 陸の塗りだけでは海との境目が見えないので、必ず線で描く。
  // 国境より強くすることで「海岸線 > 国境」の階層を作る。
  if (palette.coast) {
    ctx.beginPath();
    path(world.land);
    ctx.strokeStyle = palette.coast;
    ctx.lineWidth = 1.1 * k;
    ctx.stroke();
  }

  // --- 地球儀の輪郭 ---
  if (clipped) {
    ctx.beginPath();
    path(SPHERE);
    ctx.strokeStyle = palette.sphere;
    ctx.lineWidth = 1.2 * k;
    ctx.stroke();
  }

  ctx.restore();
}

/** 経路・ピン・ラベル・飛行機。毎フレーム変化する層。 */
export function drawOverlay(ctx, scene, p) {
  const { width, palette, projection, project, clipped } = scene;
  const k = scene.scale;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // --- 経路(未通過) ---
  // 全体を薄い破線で見せると行き先が予告されるが、
  // 「まだ通っていない線」が最初から見えているのを嫌う場合は消せるようにする
  if (project.showFutureRoute) {
    ctx.strokeStyle = palette.routeFuture;
    ctx.lineWidth = 1.6 * k;
    ctx.setLineDash([4 * k, 4 * k]);
    strokeRuns(ctx, visibleRuns(scene.geometry.pts));
    ctx.setLineDash([]);
  }

  // --- 経路(通過済み) ---
  const { taken, head } = sliceAt(scene.geometry, p);
  const runs = visibleRuns(taken);

  // 発光を1枚下に敷くと線が締まって見える
  ctx.strokeStyle = palette.route;
  ctx.globalAlpha = 0.18;
  ctx.lineWidth = 7 * k;
  strokeRuns(ctx, runs);
  ctx.globalAlpha = 1;

  ctx.lineWidth = 2.6 * k;
  strokeRuns(ctx, runs);

  // --- 地点のピン ---
  project.points.forEach((pt, i) => {
    const xy = projection(pt.coord);
    if (!xy || (clipped && !isFrontSide(projection, pt.coord))) return;
    const reveal = pointReveal(p, fractionOfPoint(scene, i));
    if (reveal <= 0) return;
    drawPin(ctx, xy, palette, k, reveal, project.pinStyle ?? 'pin');
  });

  // --- 地名ラベル ---
  if (project.showLabels) {
    const ls = scene.labelStyle;
    const size = ls.size * k;
    const pinStyle = project.pinStyle ?? 'pin';
    // ブラウザは実行環境の書体を family 名で直接解決し、Nodeは
    // 同じ名前で登録したものを引く。両者で同じ文字列を使うことで
    // プレビューと書き出しの文字が一致する。
    // 該当書体が無い環境では後ろの汎用サンセリフに落ちる。
    ctx.font = `${ls.weight} ${size.toFixed(1)}px "${ls.family}", system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    project.points.forEach((pt, i) => {
      if (!pt.name) return;
      const xy = projection(pt.coord);
      if (!xy || (clipped && !isFrontSide(projection, pt.coord))) return;
      const reveal = pointReveal(p, fractionOfPoint(scene, i));
      if (reveal <= 0) return;
      const text = ls.uppercase ? pt.name.toUpperCase() : pt.name;

      // ラベルはピンの真上ではなく横に置く。真上だと経路線と、
      // 経由地を通過中の飛行機マーカーに必ず重なるため。
      const flip = xy[0] > width * 0.78;
      const gap = (PIN.radius + 5) * k;

      ctx.globalAlpha = reveal;
      drawTrackedText(ctx, text, flip ? xy[0] - gap : xy[0] + gap, pinHeadY(xy[1], k, pinStyle), {
        align: flip ? 'right' : 'left',
        tracking: ls.tracking * size,
        fill: palette.label,
        halo: palette.labelHalo,
        haloWidth: 3.5 * k,
      });
      ctx.globalAlpha = 1;
    });
  }

  // --- 飛行機マーカー ---
  // 経由地ではピンとラベルに重なるため、最前面に置いて埋もれないようにする
  if (head && head.visible && p > 0 && p < 1) {
    drawPlane(ctx, head, headingAt(scene, p), palette, k);
  }

  ctx.restore();
}

/**
 * 字送り(トラッキング)を効かせたテキスト。
 *
 * canvasの letterSpacing は環境差があるため、1文字ずつ配置して自前で実装する。
 * プレビューと書き出しで文字位置が完全に一致することが条件なので、
 * ここは環境依存のAPIに頼らない。
 */
function drawTrackedText(ctx, text, anchorX, y, { tracking, fill, halo, haloWidth, align = 'center' }) {
  const chars = [...text];
  const widths = chars.map((c) => ctx.measureText(c).width);
  const total =
    widths.reduce((a, b) => a + b, 0) + tracking * Math.max(0, chars.length - 1);

  ctx.textAlign = 'left';
  let x =
    align === 'left' ? anchorX
    : align === 'right' ? anchorX - total
    : anchorX - total / 2;

  if (halo) {
    ctx.strokeStyle = halo;
    ctx.lineWidth = haloWidth;
    ctx.lineJoin = 'round';
    let hx = x;
    for (let i = 0; i < chars.length; i++) {
      ctx.strokeText(chars[i], hx, y);
      hx += widths[i] + tracking;
    }
  }

  ctx.fillStyle = fill;
  for (let i = 0; i < chars.length; i++) {
    ctx.fillText(chars[i], x, y);
    x += widths[i] + tracking;
  }
}

/** i番目の地点が経路全体のどこ(0..1)に当たるか。 */
function fractionOfPoint(scene, i) {
  if (i === 0) return 0;
  if (i >= scene.geometry.legStart.length) return 1;
  return scene.geometry.legStart[i];
}

/** 先端の進行方向(画面上の角度)。持ち上げ後の点列から求める。 */
function headingAt(scene, p) {
  const eps = 0.004;
  const a = sliceAt(scene.geometry, clamp01(p - eps)).head;
  const b = sliceAt(scene.geometry, clamp01(p + eps)).head;
  if (!a || !b) return 0;
  return Math.atan2(b.y - a.y, b.x - a.x);
}

/**
 * 地理座標の画面上の位置と、見えているかどうか。
 * GUI側のピンの当たり判定に使う。表示と判定で同じ関数を通すことで、
 * 「見えているのに掴めない」といったズレが起きないようにする。
 */
export function pointScreenPos(scene, coord) {
  const xy = scene.projection(coord);
  if (!xy) return null;
  const visible = !scene.clipped || isFrontSide(scene.projection, coord);
  return { x: xy[0], y: xy[1], visible, headY: pinHeadY(xy[1], scene.scale, 'pin') };
}

/** 正射図法で、その座標が手前側(見えている側)にあるか。 */
function isFrontSide(projection, coord) {
  const r = projection.rotate();
  const toRad = (d) => (d * Math.PI) / 180;
  const cLon = -r[0];
  const cLat = -r[1];
  const cos =
    Math.sin(toRad(cLat)) * Math.sin(toRad(coord[1])) +
    Math.cos(toRad(cLat)) * Math.cos(toRad(coord[1])) * Math.cos(toRad(coord[0] - cLon));
  return cos > 0;
}

/** ピンの寸法。ラベルの配置もここから決める。 */
const PIN = { radius: 6.2, offset: 13, hole: 2.6 };

/** ピンの頭(円の中心)のy座標。ラベルはこの高さに合わせる。 */
function pinHeadY(y, k, style) {
  return style === 'dot' ? y : y - PIN.offset * k;
}

/**
 * 地点のアイコン。
 *
 * 既定は地図ピン(涙型)。座標そのものは先端が指すので、
 * 円で描く場合と違って「どこを指しているか」が曖昧にならない。
 */
function drawPin(ctx, xy, palette, k, reveal, style = 'pin') {
  const [x, y] = xy;

  if (style === 'dot') {
    const r = 4.2 * k * reveal;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = palette.pin;
    ctx.fill();
    ctx.lineWidth = 2 * k;
    ctx.strokeStyle = palette.markerStroke;
    ctx.stroke();
    return;
  }

  const r = PIN.radius * k;
  const d = PIN.offset * k;
  // 先端から円へ引いた接線の角度。ここで繋ぐと涙型が滑らかになる
  const alpha = Math.acos(Math.min(1, r / d));

  ctx.save();
  ctx.translate(x, y);
  // 出現時は上から落ちてきて、先端の位置に収まる
  ctx.translate(0, -(1 - reveal) * 10 * k);
  ctx.scale(reveal, reveal);

  ctx.beginPath();
  // 先端(原点)から円の上側をぐるりと回って戻る
  ctx.arc(0, -d, r, Math.PI / 2 + alpha, Math.PI / 2 - alpha + Math.PI * 2);
  ctx.lineTo(0, 0);
  ctx.closePath();

  ctx.fillStyle = palette.pin;
  ctx.fill();
  ctx.lineWidth = 1.8 * k;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = palette.markerStroke;
  ctx.stroke();

  // 内側の抜き
  ctx.beginPath();
  ctx.arc(0, -d, PIN.hole * k, 0, Math.PI * 2);
  ctx.fillStyle = palette.pinHole ?? '#ffffff';
  ctx.fill();

  ctx.restore();
}

/** 上(-y)を機首とした旅客機の平面シルエット。 */
const PLANE = [
  [0, -1], [0.18, -0.35], [0.95, 0.15], [0.95, 0.35], [0.18, 0.05],
  [0.12, 0.62], [0.42, 0.85], [0.42, 1.0], [0, 0.82], [-0.42, 1.0],
  [-0.42, 0.85], [-0.12, 0.62], [-0.18, 0.05], [-0.95, 0.35],
  [-0.95, 0.15], [-0.18, -0.35],
];

function drawPlane(ctx, head, angle, palette, k) {
  const size = 10 * k;
  ctx.save();
  ctx.translate(head.x, head.y);
  // 形状は機首が上向きなので、進行方向へ90度ぶん補正する
  ctx.rotate(angle + Math.PI / 2);
  ctx.beginPath();
  PLANE.forEach(([x, y], i) => {
    const px = x * size;
    const py = y * size;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.closePath();
  ctx.fillStyle = palette.marker;
  ctx.strokeStyle = palette.markerStroke;
  ctx.lineWidth = 2.2 * k;
  ctx.stroke();
  ctx.fill();
  ctx.restore();
}
