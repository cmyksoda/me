// Text laid out exactly as HBC 1.1.3 lays it out (font.c), from FreeType's metrics for its Droid Sans.

import metrics from './metrics.json';
import { screen, WIDESCREEN_RATIO } from './gfx';

export type FontId = 'label' | 'dlgtitle' | 'memo' | 'appname' | 'appdesc' | 'button';
export type XAlign = 'left' | 'center' | 'right';
export type YAlign = 'ascender' | 'emCenter' | 'descender';

// Glyphs sit at HBC's pen positions, from which the outline brings its own side bearing.
export interface TextRun {
  css: string;
  y: number;
  glyphs: { ch: string; x: number }[];
  color?: string;
  underline?: boolean;
}

type Face = (typeof metrics.faces)['regular-16'];

const fonts: Record<FontId, [bold: boolean, size: number]> = {
  label: [true, 16],
  dlgtitle: [true, 20],
  memo: [false, 16],
  appname: [true, 20],
  appdesc: [true, 16],
  button: [true, 20],
};

const glyphIndex = new Map(metrics.codepoints.map((codepoint, index) => [codepoint, index]));
const missingGlyph = glyphIndex.get(0x3f)!;

// In 16:9 HBC renders glyphs narrower, in the TV's own pixels, then stretches them back.
const xRatio = () => (screen.wide ? WIDESCREEN_RATIO : 1);

function face(id: FontId): Face {
  const [bold, size] = fonts[id];
  const name = `${bold ? 'bold' : 'regular'}-${size}${screen.wide ? '-wide' : ''}`;
  return metrics.faces[name as keyof typeof metrics.faces];
}

function glyph(f: Face, ch: string) {
  const i = glyphIndex.get(ch.codePointAt(0)!) ?? missingGlyph;
  return { advance: f.advance[i], left: f.width[i] ? f.left[i] : 0, width: f.width[i] };
}

export const ascender = (id: FontId) => face(id).ascender;

export function textWidth(id: FontId, text: string) {
  const chars = [...text];
  return stringWidth(face(id), chars, chars.length) * xRatio();
}

export function lineSpacing(id: FontId) {
  return face(id).height;
}

// How many characters fit when each must start before maxWidth (0 counts them all).
export function charCount(id: FontId, text: string, maxWidth: number) {
  const f = face(id);
  const limit = Math.trunc(maxWidth / xRatio());
  const chars = [...text];
  let count = 0;
  let x = 0;
  let advance = 0;
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] === '\r' || (chars[i] === '\n' && i === chars.length - 1)) continue;
    x += advance;
    if (limit && x >= limit) return count;
    advance = glyph(f, chars[i] === '\n' ? ' ' : chars[i]).advance;
    count++;
  }
  return count;
}

function stringWidth(f: Face, chars: string[], count: number) {
  let width = 0;
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] === '\r' || (chars[i] === '\n' && i === chars.length - 1)) continue;
    width += glyph(f, chars[i] === '\n' ? ' ' : chars[i]).advance;
    if (--count === 0) break;
  }
  return width;
}

// Lines broken where HBC breaks them; null is an empty line.
export function wrap(id: FontId, text: string, maxWidth: number) {
  const f = face(id);
  const limit = Math.trunc(maxWidth / xRatio());
  const chars = [...text];
  const lines: (string | null)[] = [];
  let start = 0;
  let lastSpace = -1;
  let x = 0;
  let advance = 0;
  let p = 0;
  while (true) {
    let i = p;
    const ch = chars[p];
    if (ch !== undefined) p++;
    let lineBreak = false;
    let end = 0;
    if (ch === ' ') lastSpace = p;
    if (ch === '\n' || ch === undefined) {
      lineBreak = true;
      end = i;
      i = p;
    } else if (ch === '\r') {
      continue;
    } else {
      const g = glyph(f, ch);
      x += advance;
      if (x + Math.max(g.advance, g.width + g.left) >= limit) {
        lineBreak = true;
        if (lastSpace <= start) {
          if (i === start) i++;
          end = i;
        } else {
          end = lastSpace;
          i = lastSpace;
        }
        p = i;
      }
      advance = g.advance;
    }
    if (lineBreak) {
      lines.push(end <= start ? null : chars.slice(start, end).join(''));
      start = i;
      x = 0;
      advance = 0;
    }
    if (ch === undefined) return lines;
  }
}

export function plotString(id: FontId, text: string, x: number, y: number, width: number,
  xalign: XAlign, yalign: YAlign, count: number): TextRun {
  const f = face(id);
  const [bold, size] = fonts[id];
  const run: TextRun = { css: `${bold ? 'bold' : 'normal'} ${size}px hbc-droid`, y, glyphs: [] };
  if (!count) return run;

  const ratio = xRatio();
  const chars = [...text];
  let cx = Math.trunc(x / ratio);
  if (xalign === 'center') cx = Math.trunc(cx + (width / ratio - stringWidth(f, chars, count)) / 2);
  if (xalign === 'right') cx = Math.trunc(cx + width / ratio - stringWidth(f, chars, count));
  if (yalign === 'ascender') run.y += f.ascender;
  if (yalign === 'emCenter') run.y += Math.trunc(f.emHeight / 2);
  if (yalign === 'descender') run.y += f.descender;

  let advance = 0;
  let first = true;
  for (let i = 0; i < chars.length; i++) {
    let ch = chars[i];
    if (ch === '\n') {
      if (i === chars.length - 1) break;
      ch = ' ';
    }
    if (ch === '\r') continue;
    const g = glyph(f, ch);
    cx += advance;
    if (g.width) {
      // font.c's left-edge fudge: the first drawn glyph starts flush with x.
      if (xalign === 'left' && first && g.left > 0) cx -= g.left;
      run.glyphs.push({ ch, x: cx * ratio });
      first = false;
    }
    if (--count === 0) break;
    advance = g.advance;
  }
  return run;
}
