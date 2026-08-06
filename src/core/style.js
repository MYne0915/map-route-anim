// 淡色モノトーンのパレット。
// 海を白、陸をグレーにする。地図は「後退させる」方針なので、
// 陸・国境・経緯線はすべて低コントラストに保ち、彩度を持つのは経路とマーカーだけにする。

/**
 * 淡色モノトーンの階調。
 *
 * 海岸線 > 国境 の順に強くするのが地図の定石。陸の塗りだけで海と分けると
 * 境目が見えないため、海岸線は必ず線で描く。
 */
const tones = {
  soft: { land: '#eaeef1', coast: '#a7b3bd', border: '#ccd5db' },
  medium: { land: '#e4e9ed', coast: '#8b99a5', border: '#b6c1c9' },
  strong: { land: '#dde4e9', coast: '#6d7d89', border: '#9aa9b3' },
};

function paleBase(tone) {
  return {
    /** 地球儀の外側(球の白と区別するためにわずかに沈める) */
    backdrop: '#f1f4f6',
    ocean: '#ffffff',
    land: tone.land,
    /** 海と陸の境目。地図で最も強い線 */
    coast: tone.coast,
    border: tone.border,
    graticule: '#eef1f4',
    sphere: tone.coast,
    routeFuture: '#aab5bf',
    markerStroke: '#ffffff',
    pin: '#2b3238',
    /** ピン内側の抜き色 */
    pinHole: '#ffffff',
    label: '#2b3238',
    labelHalo: '#ffffff',
  };
}

const baseMap = paleBase(tones.soft);

export const palettes = {
  /** 既定(2026-08-06にユーザーが選択)。線を控えめにした版。 */
  paleSoft: { ...baseMap, route: '#e0553f', marker: '#e0553f' },
  /** 線を中程度にした版。 */
  paleMedium: { ...paleBase(tones.medium), route: '#e0553f', marker: '#e0553f' },
  /** 線を強めた版。海岸線・国境をはっきり見せたいとき。 */
  paleStrong: { ...paleBase(tones.strong), route: '#e0553f', marker: '#e0553f' },
  /** 寒色の差し色。落ち着いた印象。 */
  paleCool: { ...baseMap, route: '#1f4e79', marker: '#1f4e79' },
  /** 差し色を持たない完全モノトーン。最も静か。 */
  paleMono: {
    ...baseMap,
    route: '#22282d',
    marker: '#22282d',
    routeFuture: '#c2cad1',
  },

  /**
   * 地球の絵に寄せた配色。海が水色、陸が緑。
   * 淡色モノトーンと違い地図自体が主張するので、経路が負けないよう
   * 差し色は濃いめの朱色にし、経路の縁取りを白で抜いて分離する。
   */
  earth: {
    backdrop: '#eff4f7',
    ocean: '#a6d1e4',
    land: '#bdd69c',
    coast: '#7d9a63',
    border: '#9ab77c',
    graticule: '#b8dbea',
    sphere: '#83b8ce',
    routeFuture: '#6f7f88',
    route: '#d8402a',
    marker: '#d8402a',
    markerStroke: '#ffffff',
    pin: '#d8402a',
    pinHole: '#ffffff',
    label: '#28323a',
    labelHalo: '#ffffff',
  },

  /** 地球の絵風の夕暮れ版。陸を暖色の緑に寄せた落ち着いた配色。 */
  earthMuted: {
    backdrop: '#f2f4f3',
    ocean: '#b9d6de',
    land: '#c7cfa2',
    coast: '#8b9670',
    border: '#a8b287',
    graticule: '#c9dee4',
    sphere: '#93b6c0',
    routeFuture: '#77817f',
    route: '#c0492f',
    marker: '#c0492f',
    markerStroke: '#ffffff',
    pin: '#3d4a44',
    pinHole: '#ffffff',
    label: '#2b3630',
    labelHalo: '#ffffff',
  },
};

export const defaultPalette = palettes.paleSoft;

/**
 * ラベルの書体プリセット。
 * 地図ラベルは書体そのものより「大文字 + 字送りを広げる」ことで品が出るため、
 * tracking(字送り)と uppercase をプリセットに含める。
 */
export const labelStyles = {
  futura: {
    label: 'Futura(幾何学サンセリフ・大文字)',
    family: 'Futura',
    file: '/System/Library/Fonts/Supplemental/Futura.ttc',
    uppercase: true,
    tracking: 0.18,
    size: 15,
    weight: '500',
  },
  avenir: {
    label: 'Avenir Next(モダンな幾何学サンセリフ・大文字)',
    family: 'Avenir Next',
    file: '/System/Library/Fonts/Avenir Next.ttc',
    uppercase: true,
    tracking: 0.16,
    size: 14.5,
    weight: '600',
  },
  didot: {
    label: 'Didot(高コントラストのセリフ・雑誌的)',
    family: 'Didot',
    file: '/System/Library/Fonts/Supplemental/Didot.ttc',
    uppercase: true,
    tracking: 0.2,
    size: 16,
    weight: '400',
  },
  optima: {
    label: 'Optima(ヒューマニストサンセリフ・上品)',
    family: 'Optima',
    file: '/System/Library/Fonts/Optima.ttc',
    uppercase: true,
    tracking: 0.18,
    size: 15.5,
    weight: '400',
  },
  copperplate: {
    label: 'Copperplate(彫刻風・スタンプ的)',
    family: 'Copperplate',
    file: '/System/Library/Fonts/Supplemental/Copperplate.ttc',
    uppercase: true,
    tracking: 0.22,
    size: 13.5,
    weight: '400',
  },
};

export const defaultLabelStyle = 'avenir';
