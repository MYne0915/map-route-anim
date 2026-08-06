/**
 * プロジェクトのデータモデル。
 * 飛行機のみのスコープなので、地点列と見た目の設定しか持たない。
 */

export function createProject(overrides = {}) {
  return {
    points: [],
    /** orthographic | naturalEarth | equirectangular | mercator */
    projection: 'naturalEarth',
    /** route: 経路にフィット / globe: 球全体を見せる(地球儀向け) */
    fitMode: null,
    paddingPct: null,
    /**
     * 視点(向き・倍率・位置)。解像度に依存しない形で保持する。
     * null なら経路に合わせて自動算出。GUIで動かすとここに固定される。
     */
    view: null,
    /** 画面空間での弧の持ち上げ量。null なら投影法ごとの既定値 */
    arcLift: null,
    palette: 'paleSoft',
    /** 経路と飛行機の差し色。地図の配色は固定で、ここだけ変えられる */
    accentColor: '#e0553f',
    showGraticule: false,
    showLabels: true,
    /** これから通る経路を薄い破線で先に見せるか */
    showFutureRoute: false,
    /** futura | avenir | didot | optima | copperplate */
    labelStyle: 'avenir',
    /** pin: 地図ピン(涙型) / dot: 円 */
    pinStyle: 'pin',
    /** 海岸線の細かさ。110m は軽く、50m は標準、10m は詳細 */
    detail: '50m',
    duration: 12,
    holdStart: 1,
    holdEnd: 1.5,
    easing: 'easeInOutCubic',
    output: { width: 1920, height: 1080, fps: 30 },
    ...overrides,
  };
}

export function createPoint(name, lon, lat) {
  return { id: cryptoId(), name, coord: [lon, lat] };
}

/** 海岸線データの細かさ。ここに無い値はファイルパスに使わせない。 */
export const DETAIL_LEVELS = ['110m', '50m', '10m'];

const LIMITS = {
  width: [16, 7680],
  height: [16, 7680],
  fps: [1, 120],
  duration: [0.5, 600],
  points: 200,
};

/**
 * 外部から渡されたプロジェクトを検証して安全な値に正規化する。
 *
 * GUIの書き出しAPIとCLIの両方がこれを通す。とくに `detail` は
 * ファイルパスの一部になるため、必ず既知の値だけに絞る。
 */
export function sanitizeProject(input) {
  const base = createProject();
  const p = { ...base, ...(input && typeof input === 'object' ? input : {}) };

  if (!DETAIL_LEVELS.includes(p.detail)) p.detail = base.detail;

  // 視点は拡大率と位置を直接決めるので、壊れた値が入ると描画が破綻する。
  // 一つでも不正なら丸ごと捨てて、経路からの自動算出に戻す。
  p.view = validView(p.view) ? p.view : null;

  p.points = Array.isArray(p.points)
    ? p.points
        .filter(
          (pt) =>
            pt &&
            Array.isArray(pt.coord) &&
            Number.isFinite(pt.coord[0]) &&
            Number.isFinite(pt.coord[1])
        )
        .slice(0, LIMITS.points)
        .map((pt) => ({
          id: String(pt.id ?? cryptoId()).slice(0, 64),
          name: typeof pt.name === 'string' ? pt.name.slice(0, 120) : '',
          coord: [clampNum(pt.coord[0], -180, 180), clampNum(pt.coord[1], -90, 90)],
        }))
    : [];

  const out = p.output && typeof p.output === 'object' ? p.output : base.output;
  p.output = {
    // 偶数でないとyuv420pへの変換で失敗する
    width: even(clampNum(out.width, ...LIMITS.width, base.output.width)),
    height: even(clampNum(out.height, ...LIMITS.height, base.output.height)),
    fps: Math.round(clampNum(out.fps, ...LIMITS.fps, base.output.fps)),
  };

  p.duration = clampNum(p.duration, ...LIMITS.duration, base.duration);
  p.holdStart = clampNum(p.holdStart, 0, p.duration, base.holdStart);
  p.holdEnd = clampNum(p.holdEnd, 0, p.duration, base.holdEnd);

  return p;
}

function validView(v) {
  return (
    v != null &&
    typeof v === 'object' &&
    Array.isArray(v.rotate) &&
    v.rotate.length >= 2 &&
    v.rotate.every(Number.isFinite) &&
    Number.isFinite(v.zoom) &&
    v.zoom > 0 &&
    Array.isArray(v.offset) &&
    v.offset.length === 2 &&
    v.offset.every(Number.isFinite)
  );
}

function clampNum(value, min, max, fallback = min) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

const even = (n) => (n % 2 === 0 ? n : n + 1);

/** 動作確認用のサンプル。 */
export function sampleProject() {
  return createProject({
    projection: 'orthographic',
    points: [
      { id: 'a', name: 'Tokyo', coord: [139.6917, 35.6895] },
      { id: 'b', name: 'Dubai', coord: [55.2708, 25.2048] },
      { id: 'c', name: 'London', coord: [-0.1276, 51.5072] },
    ],
    palette: 'paleSoft',
    duration: 10,
  });
}

function cryptoId() {
  return Math.random().toString(36).slice(2, 10);
}
