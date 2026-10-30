// Views: what the pointer is over, focus, B-dragging, and drawing each frame (view.c).

import { drawBubbles, updateBubbles } from './bubbles';
import { pointer, scanPad, type Pad } from './controls';
import { beginFrame, clip, drawImage, drawText, drawTurned, endFrame, fill, screen, unclip, VIEW_HEIGHT } from './gfx';
import { theme } from './theme';
import { CURSOR, ENABLED, FOCUSABLE, FOCUSED, setFlag, shows, VISIBLE, fill as fillWidget, type Cursor, type Item, type Widget } from './widgets';

export interface View {
  x: number;
  y: number;
  widgets: (Widget | null)[];
  subView: View | null;
  focus: number;
  cursor: number;
  dragButton: number;
  drag: boolean;
  dragWidget: number;
  dragStartX: number;
  dragStartY: number;
  dragX: number;
  dragY: number;
}

const FOCUS_FLAGS = VISIBLE | ENABLED | FOCUSABLE;
const CURSOR_FLAGS = VISIBLE | ENABLED;

let cursorEnabled = false;
let throbber: number | null = null;
let shown: { view: View; alpha: number; cursor: Cursor | null } | null = null;

export function newView(size: number, subView: View | null, x: number, y: number, dragButton = 0): View {
  return {
    x, y, widgets: Array(size).fill(null), subView, focus: -1, cursor: -1, dragButton,
    drag: false, dragWidget: -1, dragStartX: 0, dragStartY: 0, dragX: 0, dragY: 0,
  };
}

export function enableCursor(on: boolean) {
  cursorEnabled = on;
}

export const pointing = () => cursorEnabled && pointer.valid;

export function showThrobber(on: boolean) {
  throbber = on ? 0 : null;
}

export function tickleThrobber() {
  if (throbber !== null) throbber -= 0.1;
}

export function widgetAt(v: View, x: number, y: number) {
  for (let i = v.widgets.length - 1; i >= 0; i--) {
    const w = v.widgets[i];
    if (!w?.width || !w.height) continue;
    // A memo is hit where its box is, however far its text has scrolled.
    const top = w.memo ? w.memo.yMax : w.y;
    if (x >= w.x && y >= top && x <= w.x + w.width && y <= top + w.height) return i;
  }
  return -1;
}

export function widgetAtPointer(v: View) {
  return pointing() ? widgetAt(v, pointer.x - v.x, pointer.y - v.y) : -1;
}

// Slots can empty under focus or hover, which HBC shrugs off by writing to a zeroed widget.
export function setFocus(v: View, focus: number) {
  const old = v.widgets[v.focus];
  if (old) setFlag(old, FOCUSED, false);
  v.focus = focus;
  const w = v.widgets[focus];
  if (w) setFlag(w, FOCUSED, true);
}

const focusable = (w: Widget | null) => !!w && (w.flags & FOCUS_FLAGS) === FOCUS_FLAGS;

export function focusPrevious(v: View) {
  if (v.focus < 1) return;
  for (let i = v.focus - 1; i >= 0; i--) {
    if (focusable(v.widgets[i])) return setFocus(v, i);
  }
}

export function focusNext(v: View) {
  if (v.focus === v.widgets.length - 1) return;
  for (let i = v.focus + 1; i < v.widgets.length; i++) {
    if (focusable(v.widgets[i])) return setFocus(v, i);
  }
}

export function moveFocus(v: View, by: number) {
  const target = v.focus + by;
  if (target < 1 || target > v.widgets.length - 1) return;
  if (focusable(v.widgets[target])) setFocus(v, target);
}

// One frame: read the remote, follow the pointer, then wait for the next vertical blank.
export function* plot(v: View, alpha: number): Generator<void, Pad, void> {
  const pad = scanPad();
  const { x, y } = pointer;
  const over = pointer.valid ? widgetAt(v, x - v.x, y - v.y) : -1;
  let cursor: Cursor = 'standard';

  if (v.dragButton) {
    if (pad.up & v.dragButton) v.drag = false;
    if (over !== -1 && pad.down & v.dragButton) {
      v.drag = true;
      v.dragWidget = over;
      v.dragStartX = x;
      v.dragStartY = y;
    }
    if (v.drag && pad.held & v.dragButton) {
      v.dragX = x - v.dragStartX;
      v.dragY = y - v.dragStartY;
      cursor = v.widgets[v.dragWidget]?.cursor ?? 'standard';
    }
  }

  const hovered = v.widgets[v.cursor];
  if (hovered) setFlag(hovered, CURSOR, false);
  v.cursor = -1;

  const visible = pointing();
  if (visible) {
    setFocus(v, -1);
    const w = v.widgets[over];
    if (w) {
      if ((w.flags & CURSOR_FLAGS) === CURSOR_FLAGS) {
        setFlag(w, CURSOR, true);
        v.cursor = over;
      }
      if (focusable(w)) setFocus(v, over);
      if (cursor !== 'drag') cursor = w.cursor;
    }
  }

  updateBubbles(visible, x, y);
  shown = { view: v, alpha, cursor: visible ? cursor : null };
  yield;
  return pad;
}

// Fades a black curtain away (or in) over the view.
export function* viewFade(v: View, color: number, steps: number, change: number) {
  const fade = newView(1, v, 0, 0);
  const curtain = fillWidget(-32, -32, screen.width + 64, VIEW_HEIGHT + 64, color);
  fade.widgets[0] = curtain;
  const item = curtain.layers[0].items[0] as Extract<Item, { kind: 'fill' }>;
  for (let i = 0; i < steps; i++) {
    item.color = Math.min(Math.max(item.color + change, 0), 255);
    yield* plot(fade, 0);
  }
}

function drawItem(item: Item, v: View, x: number, y: number) {
  switch (item.kind) {
    case 'image': return drawImage(item.image, x + item.x, y + item.y, item.alpha);
    case 'text': return drawText(item.run, x, y);
    case 'fill': return fill(x, y, item.width, item.height, item.color);
    case 'clip': return clip(v.x + item.x, v.y + item.y, item.width, item.height);
    case 'unclip': return unclip();
  }
}

function drawView(v: View, alpha: number) {
  if (v.subView) {
    drawView(v.subView, 0);
    fill(-5, -5, screen.width + 10, VIEW_HEIGHT + 10, alpha);
  }
  for (const w of v.widgets) {
    if (!w || !(w.flags & VISIBLE)) continue;
    for (const l of w.layers) {
      if (shows(w, l)) for (const item of l.items) drawItem(item, v, v.x + w.x, v.y + w.y);
    }
  }
}

export function render() {
  if (!shown) return;
  beginFrame();
  drawImage(screen.wide ? theme.background_wide : theme.background, 0, 0);
  drawBubbles();
  drawImage(theme.logo, 0, 416);
  drawView(shown.view, shown.alpha);
  if (throbber !== null) {
    const { throbber: image } = theme;
    drawTurned(image, Math.trunc((screen.width - image.width) / 2), Math.trunc((VIEW_HEIGHT - image.height) / 2), 1, throbber);
  }
  if (shown.cursor) {
    // The hotspot is the middle of the hand's 96 x 96 picture, with its shade 2 right and 4 down.
    const drag = shown.cursor === 'drag';
    const x = pointer.exactX - 48;
    const y = pointer.exactY - 48;
    drawImage(drag ? theme.cursor_drag_shade : theme.cursor_shade, x + 2, y + 4);
    drawImage(drag ? theme.cursor_drag : theme.cursor_pic, x, y);
  }
  endFrame();
}
