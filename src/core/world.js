import { feature, mesh } from 'topojson-client';

/**
 * Natural Earth (world-atlas の TopoJSON) を描画用のGeoJSONに変換する。
 *
 * 陸は land(一枚のポリゴン)を塗り、国境は countries の内部メッシュだけを
 * 線で引く。国ごとに塗ると隣接面の境目に継ぎ目が出るため、この分離が必要。
 */
export function buildWorld(topo) {
  const land = topo.objects.land
    ? feature(topo, topo.objects.land)
    : feature(topo, topo.objects.countries);

  const borders = topo.objects.countries
    ? mesh(topo, topo.objects.countries, (a, b) => a !== b)
    : null;

  return { land, borders };
}
