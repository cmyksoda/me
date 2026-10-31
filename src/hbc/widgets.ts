// HBC's widgets, each a stack of layers shown or hidden by the widget's flags (widgets.c).

import type { App } from './apps';
import { charCount, lineSpacing, plotString, wrap, type FontId, type TextRun, type XAlign, type YAlign } from './font';
import type { Insets } from './gfx';
import { theme } from './theme';

export const VISIBLE = 1;
export const ENABLED = 2;
export const FOCUSABLE = 4;
export const CURSOR = 32;
export const FOCUSED = 64;
const AND = 256;

const DISABLED_ALPHA = 0x54 / 255;

// What stays as drawn when a plate is resized: each is the same from side to side in its middle, and the
// dialog is flat black between its blue top and bottom.
const LIST_INSETS: Insets = [16, 24, 16, 24];
const BUTTON_INSETS: Insets = [16, 0, 16, 0];
const DIALOG_INSETS: Insets = [16, 192, 16, 112];
// A button's caption has to fit its plate: HBC's 20 px caption needs the plate at least this wide.
const BUTTON_CAPTION_MIN_WIDTH = 124;

export type Cursor = 'standard' | 'drag';

export type Item =
  | { kind: 'image'; image: HTMLImageElement; x: number; y: number; alpha: number }
  | { kind: 'sliced'; image: HTMLImageElement; x: number; y: number; width: number; height: number; insets: Insets; alpha: number }
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

// At its own size a plate is drawn whole, so HBC's own layouts keep their exact pixels.
function plate(image: HTMLImageElement, width: number, height: number, insets: Insets, alpha = 1): Item {
  if (width === image.width && height === image.height) return picture(image, 0, 0, alpha);
  return { kind: 'sliced', image, x: 0, y: 0, width, height, insets, alpha };
}

export function shows(w: Widget, l: Layer) {
  if (!l.flags) return true;
  const f = (w.flags ^ l.invert) & l.flags & 0xff;
  return f !== 0 && (!(l.flags & AND) || f === (l.flags & 0xff));
}

export function setFlag(w: Widget, flag: number, on: boolean) {
  w.flags = on ? w.flags | flag : w.flags & ~flag;
}

// Normal when idle, faded when disabled, the focus image when focused.
function focusLayers(normal: HTMLImageElement, focused: HTMLImageElement, width = normal.width, height = normal.height, insets: Insets = [0, 0, 0, 0]) {
  const at = (image: HTMLImageElement, alpha?: number) => plate(image, width, height, insets, alpha);
  return [
    layer(FOCUSED | AND | ENABLED, FOCUSED, at(normal)),
    layer(ENABLED, ENABLED, at(normal, DISABLED_ALPHA)),
    layer(FOCUSED | AND | ENABLED, 0, at(focused)),
  ];
}

// `reach` widens what answers to the pointer past the picture, for buttons a finger has to hit.
export function image(x: number, y: number, normal: HTMLImageElement, disabled?: HTMLImageElement, hover?: HTMLImageElement, reach = 0) {
  const at = (image: HTMLImageElement, alpha = 1) => picture(image, reach, reach, alpha);
  const layers = [hover ? layer(ENABLED | AND | CURSOR, CURSOR, at(normal)) : layer(ENABLED, 0, at(normal))];
  if (disabled) layers.push(layer(ENABLED, ENABLED, at(disabled)));
  if (hover) layers.push(layer(ENABLED | AND | CURSOR, 0, at(hover)));
  return widget(x - reach, y - reach, normal.width + 2 * reach, normal.height + 2 * reach, false, layers);
}

export function panel(width: number, height: number) {
  return widget(0, 0, width, height, false, [layer(ENABLED, 0, plate(theme.dialog_background, width, height, DIALOG_INSETS))]);
}

export function label(x: number, y: number, caption: string, width: number, xalign: XAlign, yalign: YAlign, font: FontId) {
  const run = plotString(font, caption, 0, 0, width, xalign, yalign, charCount(font, caption, width));
  return widget(x, y, 0, 0, false, [layer(0, 0, text(run))]);
}

export function button(x: number, y: number, caption: string, plateWidth = theme.button_tiny.width) {
  const normal = theme.button_tiny;
  // A narrow plate takes the 16 px caption, with a little less room on each side.
  const [font, inset] = plateWidth >= BUTTON_CAPTION_MIN_WIDTH ? (['button', 16] as const) : (['label', 12] as const);
  const width = plateWidth - 2 * inset;
  const count = charCount(font, caption, width);
  const run = plotString(font, caption, inset, normal.height / 2, width, 'center', 'emCenter', count);
  const layers = [...focusLayers(normal, theme.button_tiny_focus, plateWidth, normal.height, BUTTON_INSETS), layer(0, 0, text(run))];
  return widget(x, y, plateWidth, normal.height, true, layers);
}

// A plate narrower than HBC's shows little of a description on one line, so it grows by a line and lets
// the description take two.
export const entryHeight = (plateWidth = theme.apps_list.width) =>
  theme.apps_list.height + (plateWidth < theme.apps_list.width ? lineSpacing('appdesc') : 0);

export function appEntry(x: number, y: number, app: App, plateWidth = theme.apps_list.width) {
  const background = theme.apps_list;
  const height = entryHeight(plateWidth);
  const grown = height - background.height;
  const width = plateWidth - 156 - 16;
  const spacing = lineSpacing('appdesc');
  const description = app.shortDescription ?? '<no description>';
  const lines = grown ? wrap('appdesc', description, width).slice(0, 2).map((line) => line ?? '') : [description];
  // The text stays in the middle of the plate, so a single line sits half a line lower than two would.
  const shift = Math.trunc((grown - (lines.length - 1) * spacing) / 2);
  const items = [
    text(plotString('appname', app.name, 156, 8 + shift, width, 'left', 'ascender', charCount('appname', app.name, width))),
    ...lines.map((line, i) =>
      text(plotString('appdesc', line, 156, 54 + shift + i * spacing, width, 'left', 'descender', charCount('appdesc', line, width)))),
  ];
  if (app.icon) items.push(picture(app.icon, 8, 8 + Math.trunc(grown / 2)));
  const layers = [...focusLayers(background, theme.apps_list_hover, plateWidth, height, LIST_INSETS), layer(0, 0, ...items)];
  return widget(x, y, plateWidth, height, true, layers);
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
