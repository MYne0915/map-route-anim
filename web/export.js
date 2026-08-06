import { Muxer, ArrayBufferTarget } from 'mp4-muxer';

import { prepareScene, cacheBasemap, drawFrame, drawFrameAtProgress } from '../src/core/draw.js';
import { frameCount } from '../src/core/timeline.js';
import { sanitizeProject } from '../src/core/project.js';

/**
 * ブラウザ内でMP4を書き出す。
 *
 * WebCodecs の VideoEncoder でH.264に符号化し、mp4-muxer でMP4に詰める。
 * ffmpeg.wasm を使わないのは、コアだけで64MBある上に、マルチスレッド版は
 * SharedArrayBuffer(=COOP/COEPヘッダ)を要求し、GitHub Pagesでは
 * そのヘッダを設定できないため。WebCodecsならハードウェア符号化が使え、
 * 追加の依存も muxer 数十KBだけで済む。
 *
 * 描画は scripts/render.mjs と同じ drawFrame を呼ぶ。
 * ここに描画ロジックを書かないこと。
 */

/** この環境でブラウザ書き出しが使えるか。 */
export function canExportInBrowser() {
  return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
}

/** H.264 のレベルを解像度とfpsから選ぶ。低すぎると configure が失敗する。 */
function avcCodecString(width, height, fps) {
  const mbs = Math.ceil(width / 16) * Math.ceil(height / 16);
  const mbsPerSec = mbs * fps;
  // High profile (64) + 各レベル。4Kまで通るように余裕を持たせる
  let level = 0x1f; // 3.1
  if (mbs > 8192 || mbsPerSec > 245760) level = 0x33; // 5.1
  else if (mbs > 5120 || mbsPerSec > 216000) level = 0x32; // 5.0
  else if (mbs > 3600 || mbsPerSec > 61440) level = 0x29; // 4.1
  else if (mbs > 1620 || mbsPerSec > 40500) level = 0x28; // 4.0
  // 形式は avc1.PPCCLL の6桁(プロファイル / 制約フラグ / レベル)。
  // 制約フラグの1バイトを省くと VideoEncoder に拒否される。
  return `avc1.6400${level.toString(16).padStart(2, '0')}`;
}

/** 解像度とfpsからおおよそのビットレートを決める。 */
function bitrateFor(width, height, fps) {
  // 1080p30 でおよそ 12Mbps 相当。画素数とfpsに比例させる
  const perPixel = 0.19;
  return Math.round(width * height * fps * perPixel);
}

/**
 * @param {object} rawProject
 * @param {object} world 変換済みのGeoJSON(land / borders)
 * @param {(done:number, total:number)=>void} [onProgress]
 * @returns {Promise<Blob>}
 */
export async function exportMp4(rawProject, world, onProgress) {
  if (!canExportInBrowser()) {
    throw new Error('このブラウザは書き出しに必要なWebCodecsに対応していません');
  }

  const project = sanitizeProject(rawProject);
  const { width, height, fps } = project.output;

  const codec = avcCodecString(width, height, fps);
  const support = await VideoEncoder.isConfigSupported({ codec, width, height, framerate: fps });
  if (!support.supported) {
    throw new Error(`この解像度では符号化できません (${width}×${height} @${fps}fps)`);
  }

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    // frameRate を渡すとタイムスタンプがフレーム間隔に丸められ、累積誤差を防げる
    video: { codec: 'avc', width, height, frameRate: fps },
    // 再生開始を速くする。DaVinci等に渡す前提でも扱いやすい
    fastStart: 'in-memory',
  });

  let encodeError = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => (encodeError = e),
  });
  encoder.configure({
    codec,
    width,
    height,
    framerate: fps,
    bitrate: bitrateFor(width, height, fps),
    latencyMode: 'quality',
  });

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });

  // 地図は全フレーム共通なので一度だけ焼く。これが無いと極端に遅くなる
  const scene = cacheBasemap(
    prepareScene(project, world, { width, height }),
    (w, h) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      return c;
    }
  );

  const total = frameCount({ duration: project.duration, fps });
  const frameDuration = 1e6 / fps;

  try {
    for (let i = 0; i < total; i++) {
      if (encodeError) throw encodeError;

      drawFrame(ctx, scene, i / fps);

      const frame = new VideoFrame(canvas, {
        timestamp: Math.round(i * frameDuration),
        duration: Math.round(frameDuration),
      });
      // 2秒ごとにキーフレームを置く(シーク性のため)
      encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
      frame.close();

      // 符号化が追いつかないとメモリを食い潰すので、溜まったら待つ
      if (encoder.encodeQueueSize > 8) {
        await new Promise((r) => setTimeout(r, 0));
        while (encoder.encodeQueueSize > 4) {
          await new Promise((r) => setTimeout(r, 4));
        }
      }

      if (onProgress && i % 5 === 0) onProgress(i + 1, total);
      // UIを固まらせないために定期的に制御を返す
      if (i % 10 === 0) await new Promise((r) => requestAnimationFrame(r));
    }

    await encoder.flush();
    if (encodeError) throw encodeError;
    muxer.finalize();
  } finally {
    if (encoder.state !== 'closed') encoder.close();
  }

  if (onProgress) onProgress(total, total);
  return new Blob([muxer.target.buffer], { type: 'video/mp4' });
}

/**
 * 現在の再生位置のフレームを、出力解像度のPNGとして書き出す。
 * プレビューと同じ drawFrameAtProgress を出力解像度で呼ぶだけなので、
 * 画面で見えているコマがそのまま出る。
 *
 * @param {object} rawProject
 * @param {object} world
 * @param {number} progress 0..1
 * @returns {Promise<Blob>}
 */
export async function exportPng(rawProject, world, progress) {
  const project = sanitizeProject(rawProject);
  const { width, height } = project.output;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });

  const scene = prepareScene(project, world, { width, height });
  drawFrameAtProgress(ctx, scene, progress);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('PNGを生成できませんでした'))),
      'image/png'
    );
  });
}

/** Blobをダウンロードさせる。 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  // Safariが読み終える前に破棄しないよう少し待つ
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
