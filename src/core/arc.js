import { geoInterpolate, geoDistance } from 'd3-geo';

/**
 * 経由地を含む地点列を、区間(leg)ごとの大円で結ぶ。
 * 飛行機のみのスコープなので、経路 = 大円の連結でよい(ルーティングAPI不要)。
 */

/** 大円上を等間隔にサンプリングした座標列を返す。 */
export function greatCircle(from, to, samples = 128) {
  const interp = geoInterpolate(from, to);
  const pts = [];
  for (let i = 0; i <= samples; i++) pts.push(interp(i / samples));
  return pts;
}

/**
 * 地点列から区間を組み立てる。
 * 区間長(球面距離)に応じてサンプル数を変え、短距離でも長距離でも
 * 弧の滑らかさが一定になるようにする。
 */
export function buildLegs(points) {
  const legs = [];
  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i];
    const to = points[i + 1];
    const dist = geoDistance(from.coord, to.coord); // ラジアン
    const samples = Math.max(24, Math.min(512, Math.round(dist * 400)));
    legs.push({
      from,
      to,
      dist,
      points: greatCircle(from.coord, to.coord, samples),
    });
  }
  return legs;
}

/** 全区間の合計距離。進捗の距離按分に使う。 */
export function totalDistance(legs) {
  return legs.reduce((sum, leg) => sum + leg.dist, 0);
}

/**
 * 進捗 p (0..1) の時点における「描画済みの座標列」と「先端の位置」を返す。
 * 距離按分なので、長い区間ほど時間がかかる(等速移動に見える)。
 */
export function sampleRoute(legs, p) {
  const total = totalDistance(legs);
  const target = total * clamp01(p);

  const drawn = [];
  let acc = 0;
  let head = null;
  let headLegIndex = 0;

  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    if (acc + leg.dist <= target) {
      // 区間まるごと描画済み
      drawn.push(leg.points.slice());
      acc += leg.dist;
      head = leg.points[leg.points.length - 1];
      headLegIndex = i;
      continue;
    }
    // この区間の途中に先端がある
    const localP = leg.dist === 0 ? 1 : (target - acc) / leg.dist;
    const interp = geoInterpolate(leg.from.coord, leg.to.coord);
    const cut = Math.floor(localP * (leg.points.length - 1));
    const partial = leg.points.slice(0, cut + 1);
    const headPos = interp(localP);
    partial.push(headPos);
    drawn.push(partial);
    head = headPos;
    headLegIndex = i;
    break;
  }

  if (head === null) {
    head = legs.length ? legs[0].points[0] : null;
  }

  return { drawn, head, headLegIndex };
}

/**
 * 先端の進行方位(度)。マーカーの向きに使う。
 * 大円上では方位が刻々と変わるため、先端の直前の点との差分から求める。
 */
export function headBearing(legs, p) {
  const eps = 0.001;
  const a = sampleRoute(legs, Math.max(0, clamp01(p) - eps)).head;
  const b = sampleRoute(legs, Math.min(1, clamp01(p) + eps)).head;
  if (!a || !b) return 0;
  return bearing(a, b);
}

/** 2点間の初期方位角(度、北=0、時計回り)。 */
export function bearing(from, to) {
  const [lon1, lat1] = from.map(toRad);
  const [lon2, lat2] = to.map(toRad);
  const dLon = lon2 - lon1;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

/** 経路全体をGeoJSONにする。投影のフィット計算に渡す。 */
export function routeGeoJSON(legs) {
  return {
    type: 'MultiLineString',
    coordinates: legs.map((leg) => leg.points),
  };
}

const toRad = (d) => (d * Math.PI) / 180;
export const clamp01 = (v) => Math.max(0, Math.min(1, v));
