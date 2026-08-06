import {
  geoOrthographic,
  geoNaturalEarth1,
  geoMercator,
  geoEquirectangular,
  geoCentroid,
  geoPath,
  geoGraticule10,
} from 'd3-geo';

/**
 * 投影法はプロジェクトごとに切り替える。
 * d3-geoは投影オブジェクトを差し替えるだけで済むので、
 * フィット計算を投影非依存(fitExtent)に書いておけば切り替えコストはほぼゼロ。
 */
export const projections = {
  orthographic: {
    label: '地球儀風(正射図法)',
    factory: geoOrthographic,
    /** 球体なので裏側を隠す必要がある */
    clipped: true,
    /** 経路の重心へ経度・緯度の両方を回す */
    rotateLat: true,
    graticuleByDefault: true,
  },
  naturalEarth: {
    label: '自然地球図法',
    factory: geoNaturalEarth1,
    clipped: false,
    rotateLat: false,
    graticuleByDefault: false,
  },
  equirectangular: {
    label: '正距円筒図法',
    factory: geoEquirectangular,
    clipped: false,
    rotateLat: false,
    graticuleByDefault: false,
  },
  mercator: {
    label: 'メルカトル図法',
    factory: geoMercator,
    clipped: false,
    rotateLat: false,
    graticuleByDefault: false,
  },
};

export const SPHERE = { type: 'Sphere' };

/**
 * 投影を組み立てる。
 *
 * 経度を経路の重心へ回すのは見た目の好みではなく必須の処理で、
 * これをやらないと太平洋を跨ぐ経路(東京→ロサンゼルス等)が
 * 経度±180で分断される。
 */
export function buildProjection({
  kind = 'naturalEarth',
  width,
  height,
  paddingPct = 12,
  route,
  fitMode = 'route',
  rotate = null,
}) {
  const spec = projections[kind] ?? projections.naturalEarth;
  const proj = spec.factory();

  if (spec.clipped) proj.clipAngle(90);

  // 空のGeoJSONを渡すと重心がNaNになるので、必ず有限値に落とす
  const raw = rotate ?? geoCentroid(route);
  const center = [
    Number.isFinite(raw?.[0]) ? raw[0] : 0,
    Number.isFinite(raw?.[1]) ? raw[1] : 0,
  ];
  proj.rotate(
    spec.rotateLat ? [-center[0], -center[1]] : [-center[0], 0]
  );

  const pad = (Math.min(width, height) * paddingPct) / 100;
  const extent = [
    [pad, pad],
    [width - pad, height - pad],
  ];
  proj.fitExtent(extent, fitMode === 'globe' ? SPHERE : route);

  return proj;
}

/**
 * 視点(view)は解像度に依存しない形で保持する。
 *
 *   rotate … 投影の回転(地図の向き)
 *   zoom   … 短辺に対する倍率。scale = zoom * min(width, height)
 *   offset … 画面中心からのずれ。キャンバスサイズに対する比率
 *
 * こうしておくと、プレビュー(960px)で調整した見え方が
 * 書き出し(1920px以上)でもそのまま再現される。
 */
export function viewFromProjection(proj, width, height) {
  const t = proj.translate();
  return {
    rotate: proj.rotate(),
    zoom: proj.scale() / Math.min(width, height),
    offset: [(t[0] - width / 2) / width, (t[1] - height / 2) / height],
  };
}

/** 経路に合わせた視点を計算する。「画面に合わせる」操作の中身。 */
export function fitView({ kind, width, height, paddingPct, route, fitMode }) {
  const proj = buildProjection({ kind, width, height, paddingPct, route, fitMode });
  return viewFromProjection(proj, width, height);
}

/** 保持している視点から投影を組み立てる。 */
export function projectionFromView(kind, view, width, height) {
  const spec = projections[kind] ?? projections.naturalEarth;
  const proj = spec.factory();
  if (spec.clipped) proj.clipAngle(90);
  proj.rotate(view.rotate);
  proj.scale(view.zoom * Math.min(width, height));
  proj.translate([
    width / 2 + view.offset[0] * width,
    height / 2 + view.offset[1] * height,
  ]);
  return proj;
}

/** 経路の重心。地球儀の回転先や初期向きの基準に使う。 */
export function routeCenter(route) {
  return geoCentroid(route);
}

export function makePath(projection, ctx) {
  return geoPath(projection, ctx);
}

export function graticule() {
  return geoGraticule10();
}
