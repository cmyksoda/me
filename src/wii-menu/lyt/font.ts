import type { TextContent, Vec2 } from './brlyt';

/** A menu font subset made by tools/wii/build_menu_assets.py. */
export interface FontMetrics {
  cellWidth: number;
  cellHeight: number;
  baseline: number;
  lineFeed: number;
  width: number;
  height: number;
  ascent: number;
  defaultWidths: [number, number, number];
  atlas: [number, number];
  /** Code point → [atlas x, atlas y, left, glyph width, advance]. */
  glyphs: Record<string, [number, number, number, number, number]>;
}

export interface GlyphQuad {
  /** The character's position in the string, for per-character colors. */
  index: number;
  /** Pane-local corners, y pointing down as NW4R's CharWriter draws. */
  left: number;
  top: number;
  right: number;
  bottom: number;
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

interface Line {
  start: number;
  end: number;
  width: number;
}

function advance(font: FontMetrics, code: number): number {
  return font.glyphs[code]?.[4] ?? font.defaultWidths[2];
}

/**
 * Splits text into lines the way lyt's CalcLineRectImpl does, wrapping at the pane width.
 * `breaks` counts newlines and wraps: each moves the cursor down a line, even a trailing newline.
 */
function splitLines(font: FontMetrics, text: string, scaleH: number, charSpace: number, maxWidth: number) {
  const lines: Line[] = [];
  let breaks = 0;
  let start = 0;
  do {
    let x = 0;
    let end = start;
    let spaced = false;
    for (; end < text.length; end++) {
      const code = text.charCodeAt(end);
      if (code === 10) {
        end++;
        breaks++;
        break;
      }
      if (code < 32) continue;
      const next = x + (spaced ? charSpace : 0) + advance(font, code) * scaleH;
      if (next > maxWidth && end > start) {
        breaks++;
        break;
      }
      x = next;
      spaced = true;
    }
    lines.push({ start, end, width: x });
    start = end;
  } while (start < text.length);
  return { lines, breaks };
}

// A long letter is laid out by the board for its links and again by the renderer, so a few are kept.
const laidOut = new WeakMap<TextContent, Map<string, GlyphQuad[]>>();

/**
 * Lays out a text box's string into glyph quads, following lyt::TextBox::DrawSelf and
 * ut::TextWriterBase: text position anchors the block and aligns each line inside it.
 */
export function layoutText(font: FontMetrics, content: TextContent, text: string, origin: number, size: Vec2): GlyphQuad[] {
  const key = `${origin} ${size[0]} ${size[1]} ${text}`;
  let memo = laidOut.get(content);
  if (!memo) laidOut.set(content, (memo = new Map()));
  let quads = memo.get(key);
  if (!quads) {
    memo.set(key, (quads = layOut(font, content, text, origin, size)));
    if (memo.size > 8) memo.delete(memo.keys().next().value!);
  }
  return quads;
}

function layOut(font: FontMetrics, content: TextContent, text: string, origin: number, size: Vec2): GlyphQuad[] {
  const scaleH = content.fontSize[0] / font.width;
  const scaleV = content.fontSize[1] / font.height;
  const lineHeight = content.lineSpace + font.lineFeed * scaleV;
  const fontHeight = font.height * scaleV;
  const { lines, breaks } = splitLines(font, text, scaleH, content.charSpace, size[0]);

  const textWidth = Math.max(0, ...lines.map((l) => l.width));
  const textHeight = breaks === 0 ? lineHeight : Math.max(lineHeight, breaks * lineHeight + fontHeight);

  const magH = (content.position % 3) / 2;
  const magV = Math.floor(content.position / 3) / 2;
  const baseX = -((origin % 3) / 2) * size[0];
  const baseY = -(Math.floor(origin / 3) / 2) * size[1];
  const left = baseX + (size[0] - textWidth) * magH;
  const top = baseY + (size[1] - textHeight) * magV;

  const [atlasWidth, atlasHeight] = font.atlas;
  const quads: GlyphQuad[] = [];
  lines.forEach((line, index) => {
    let x = left + magH * (textWidth - line.width);
    const glyphTop = top + index * lineHeight + (font.ascent - font.baseline) * scaleV;
    let spaced = false;
    for (let i = line.start; i < line.end; i++) {
      const code = text.charCodeAt(i);
      if (code < 32) continue;
      if (spaced) x += content.charSpace;
      spaced = true;
      const glyph = font.glyphs[code];
      if (glyph) {
        const [gx, gy, bearing, glyphWidth] = glyph;
        const glyphLeft = x + bearing * scaleH;
        quads.push({
          index: i,
          left: glyphLeft,
          top: glyphTop,
          right: glyphLeft + glyphWidth * scaleH,
          bottom: glyphTop + font.cellHeight * scaleV,
          u0: gx / atlasWidth,
          v0: gy / atlasHeight,
          u1: (gx + glyphWidth) / atlasWidth,
          v1: (gy + font.cellHeight) / atlasHeight,
        });
      }
      x += advance(font, code) * scaleH;
    }
  });
  return quads;
}

/** The width NW4R's CalcStringRect gives a single line of text at a text box's font size. */
export function measureText(font: FontMetrics, content: TextContent, text: string): number {
  const scaleH = content.fontSize[0] / font.width;
  let width = 0;
  for (let i = 0; i < text.length; i++) {
    if (i > 0) width += content.charSpace;
    width += advance(font, text.charCodeAt(i)) * scaleH;
  }
  return width;
}
