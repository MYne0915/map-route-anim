import { clamp01 } from './arc.js';

/**
 * 時刻 t(秒)から経路の進捗 p(0..1)を求める。
 *
 * 旧実装は距離按分の等速だったが、等速はそれだけで安っぽく見えるため
 * ease-in-out を既定にし、出発前と到着後に「溜め」を置く。
 */
export function progressAt(t, { duration, holdStart = 0, holdEnd = 0, easing = 'easeInOutCubic' }) {
  const moving = Math.max(0.01, duration - holdStart - holdEnd);
  const raw = clamp01((t - holdStart) / moving);
  return easings[easing] ? easings[easing](raw) : raw;
}

export const easings = {
  linear: (t) => t,
  easeInOutCubic: (t) =>
    t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
  easeInOutQuint: (t) =>
    t < 0.5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2,
  easeOutCubic: (t) => 1 - Math.pow(1 - t, 3),
};

/** 総フレーム数。 */
export function frameCount({ duration, fps }) {
  return Math.max(1, Math.round(duration * fps));
}

/**
 * 地点が「到着済み」になった度合い(0..1)。
 * ピンのドロップや地名の出現を、先端が通過した瞬間に合わせるために使う。
 */
export function pointReveal(p, pointFraction, ramp = 0.04) {
  return clamp01((p - pointFraction) / ramp + 1);
}
