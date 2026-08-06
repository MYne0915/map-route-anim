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
