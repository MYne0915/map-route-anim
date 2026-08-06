import { GlobalFonts } from '@napi-rs/canvas';
import { existsSync } from 'node:fs';
import { labelStyles } from '../core/style.js';

/**
 * Node側(書き出し)で使うフォントを登録する。
 * ブラウザ側はCSSの @font-face / local() で同じ family 名を解決させる。
 * family名を両者で揃えることが、プレビューと書き出しを一致させる条件。
 */
export function registerLabelFonts() {
  const missing = [];
  for (const style of Object.values(labelStyles)) {
    if (!existsSync(style.file)) {
      missing.push(`${style.family} (${style.file})`);
      continue;
    }
    try {
      GlobalFonts.registerFromPath(style.file, style.family);
    } catch (err) {
      missing.push(`${style.family}: ${err.message}`);
    }
  }
  if (missing.length) {
    console.warn('登録できなかったフォント:\n  ' + missing.join('\n  '));
  }
}
