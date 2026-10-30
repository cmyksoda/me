// HBC's widgets, each a stack of layers shown or hidden by the widget's flags (widgets.c).

import type { App } from './apps';
import { charCount, lineSpacing, plotString, wrap, type FontId, type TextRun, type XAlign, type YAlign } from './font';
import { theme } from './theme';

export const VISIBLE = 1;
export const ENABLED = 2;
export const FOCUSABLE = 4;
export const CURSOR = 32;
export const FOCUSED = 64;
const AND = 256;

const DISABLED_ALPHA = 0x54 / 255;

export type Cursor = 'standard' | 'drag';

export type Item =
  | { kind: 'image'; image: HTMLImageElement; x: number; y: number; alpha: number }
  | { kind: 'text'; run: TextRun }
  | { kind: 'fill'; width: number; height: number; color: number }
  | { kind: 'clip'; x: number; y: number; width: number; height: number }
  | { kind: 'unclip' };

export interface Layer {
  flags: number;
  invert: number;
  items: Item[];
}

export interface Widget {
  x: number;
  y: number;
  width: number;
  height: number;
  flags: number;
  cursor: Cursor;
  layers: Layer[];
  memo?: { yMin: number; yMax: number };
}

function widget(x: number, y: number, width: number, height: number, focusable: boolean, layers: Layer[]): Widget {
  const flags = VISIBLE | ENABLED | (focusable ? FOCUSABLE : 0);
  return { x, y, width, height, flags, cursor: 'standard', layers };
}

const layer = (flags: number, invert: number, ...items: Item[]): Layer => ({ flags, invert, items });

const picture = (image: HTMLImageElement, x = 0, y = 0, alpha = 1): Item => ({ kind: 'image', image, x, y, alpha });

const text = (run: TextRun): Item => ({ kind: 'text', run });

export function shows(w: Widget, l: Layer) {
  if (!l.flags) return true;
  const f = (w.flags ^ l.invert) & l.flags & 0xff;
  return f !== 0 && (!(l.flags & AND) || f === (l.flags & 0xff));
}

export function setFlag(w: Widget, flag: number, on: boolean) {
  w.flags = on ? w.flags | flag : w.flags & ~flag;
}

// Normal when idle, faded when disabled, the focus image when focused.
function focusLayers(normal: HTMLImageElement, focused: HTMLImageElement) {
  return [
    layer(FOCUSED | AND | ENABLED, FOCUSED, picture(normal)),
    layer(ENABLED, ENABLED, picture(normal, 0, 0, DISABLED_ALPHA)),
    layer(FOCUSED | AND | ENABLED, 0, picture(focused)),
  ];
}

export function image(x: number, y: number, normal: HTMLImageElement, disabled?: HTMLImageElement, hover?: HTMLImageElement) {
  const layers = [hover ? layer(ENABLED | AND | CURSOR, CURSOR, picture(normal)) : layer(ENABLED, 0, picture(normal))];
  if (disabled) layers.push(layer(ENABLED, ENABLED, picture(disabled)));
  if (hover) layers.push(layer(ENABLED | AND | CURSOR, 0, picture(hover)));
  return widget(x, y, normal.width, normal.height, false, layers);
}

export function label(x: number, y: number, caption: string, width: number, xalign: XAlign, yalign: YAlign, font: FontId) {
  const run = plotString(font, caption, 0, 0, width, xalign, yalign, charCount(font, caption, width));
  return widget(x, y, 0, 0, false, [layer(0, 0, text(run))]);
}

export function button(x: number, y: number, caption: string) {
  const normal = theme.button_tiny;
  const width = normal.width - 32;
  const count = charCount('button', caption, width);
  const run = plotString('button', caption, 16, normal.height / 2, width, 'center', 'emCenter', count);
  const layers = [...focusLayers(normal, theme.button_tiny_focus), layer(0, 0, text(run))];
  return widget(x, y, normal.width, normal.height, true, layers);
}

export function appEntry(x: number, y: number, app: App) {
  const background = theme.apps_list;
  const width = background.width - 156 - 16;
  const description = app.shortDescription ?? '<no description>';
  const items = [
    text(plotString('appname', app.name, 156, 8, width, 'left', 'ascender', charCount('appname', app.name, width))),
    text(plotString('appdesc', description, 156, 54, width, 'left', 'descender', charCount('appdesc', description, width))),
  ];
  if (app.icon) items.push(picture(app.icon, 8, 8));
  const layers = [...focusLayers(background, theme.apps_list_hover), layer(0, 0, ...items)];
  return widget(x, y, background.width, background.height, true, layers);
}

export function gridAppEntry(x: number, y: number, app: App) {
  const background = theme.apps_grid;
  const layers = focusLayers(background, theme.apps_grid_hover);
  if (app.icon) layers.push(layer(0, 0, picture(app.icon, 8, 8)));
  return widget(x, y, background.width, background.height, true, layers);
}

export function fill(x: number, y: number, width: number, height: number, color: number) {
  return widget(x, y, 0, 0, false, [layer(0, 0, { kind: 'fill', width, height, color })]);
}

export function memo(x: number, y: number, width: number, height: number, content: string, align: XAlign) {
  const spacing = lineSpacing('memo');
  const lines = wrap('memo', content, width);
  const fits = Math.trunc((height + spacing - 1) / spacing);
  // Text shorter than the box is centered on whole lines.
  const offset = fits > lines.length ? Math.trunc((fits - lines.length) / 2) * spacing : 0;

  const items: Item[] = [{ kind: 'clip', x, y, width, height }];
  let lineY = 0;
  for (const line of lines) {
    if (line) items.push(text(plotString('memo', line, 0, lineY, width, align, 'ascender', charCount('memo', line, 0))));
    lineY += spacing;
  }
  items.push({ kind: 'unclip' });

  const w = widget(x, y + offset, width, height, false, [layer(0, 0, ...items)]);
  if (lines.filter(Boolean).length > fits) w.cursor = 'drag';
  w.memo = { yMax: w.y, yMin: w.y - lineY + height };
  return w;
}

export function scrollMemo(w: Widget, by: number) {
  w.y = Math.min(Math.max(w.y + by, w.memo!.yMin), w.memo!.yMax);
}

// A memo between two arrows that show while there's more text that way.
export function memoDeco(x: number, y: number, width: number, height: number, content: string, align: XAlign) {
  const up = theme.content_arrow_up;
  const down = theme.content_arrow_down;
  const box = height - up.height - 8 - down.height - 8;
  const deco = [
    image(x + Math.trunc((width - up.width) / 2), y, up),
    memo(x, y + up.height + 8, width, box, content, align),
    image(x + Math.trunc((width - down.width) / 2), y + height - down.height, down),
  ];
  scrollMemoDeco(deco, 0);
  return deco;
}

export function scrollMemoDeco(deco: (Widget | null)[], by: number) {
  const [up, text, down] = deco as Widget[];
  scrollMemo(text, by);
  setFlag(up, VISIBLE, text.y < text.memo!.yMax);
  setFlag(down, VISIBLE, text.y > text.memo!.yMin);
}
