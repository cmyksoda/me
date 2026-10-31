// The TV: a canvas over the whole window, drawn at the device's own resolution (gfx.c).

import type { TextRun } from './font';

export const VIEW_HEIGHT = 480;
export const WIDESCREEN_RATIO = 852 / 640;

const WIDTH_4_3 = 640;
export const WIDTH_16_9 = 852;
// Windows this close to 4:3 or 16:9 get exactly the console's layout, which was matched pixel for pixel.
const NATIVE_TOLERANCE = 0.005;
// A tall window's view is as wide as the window in CSS pixels, so HBC's 16 px text stays 16 px on a phone. Past
// 480 (HBC's own height) it stops growing, and a tablet shows the art larger instead.
const TALL_MIN_WIDTH = 360;
const TALL_MAX_WIDTH = 480;

export interface Layout {
  portrait: boolean;
  wide: boolean;
  width: number;
  height: number;
}

// width and height are the view's size in HBC pixels (the height is 480 unless the window is tall);
// left and right are where the window's edges fall in them.
export const screen = { portrait: false, wide: true, width: WIDTH_16_9, height: VIEW_HEIGHT, left: 0, right: WIDTH_16_9 };

const canvas = document.querySelector<HTMLCanvasElement>('#tv')!;
const ctx = canvas.getContext('2d', { alpha: false })!;
let scale = 1;
let left = 0;
let top = 0;
let clipTop = 0;
let clipBottom = VIEW_HEIGHT;

function windowSize() {
  const ratio = devicePixelRatio || 1;
  return { width: Math.round(innerWidth * ratio), height: Math.round(innerHeight * ratio) };
}

// Text is laid out for 16:9 once the window is closer to it than to 4:3. Windows narrower than 4:3 stay 4:3, letterboxed,
// until they are taller than wide: those get the tall layout, in a view that follows the window's shape.
export function windowLayout(): Layout {
  const { width, height } = windowSize();
  if (height > width) {
    const viewWidth = Math.min(Math.max(Math.floor(innerWidth), TALL_MIN_WIDTH), TALL_MAX_WIDTH);
    return { portrait: true, wide: false, width: viewWidth, height: Math.floor((viewWidth * height) / width + 1e-6) };
  }
  const aspect = height > 0 ? width / height : 0;
  const near = (ratio: number) => Math.abs(aspect / ratio - 1) < NATIVE_TOLERANCE;
  let viewWidth = WIDTH_4_3;
  if (near(16 / 9)) viewWidth = WIDTH_16_9;
  else if (!near(4 / 3)) viewWidth = Math.max(WIDTH_4_3, Math.floor(VIEW_HEIGHT * aspect + 1e-6));
  return { portrait: false, wide: aspect >= Math.sqrt((4 / 3) * (16 / 9)), width: viewWidth, height: VIEW_HEIGHT };
}

export function setLayout(layout: Layout) {
  Object.assign(screen, layout);
}

// HBC pixels in a distance measured in CSS pixels, for what a finger can tell apart.
export const viewPixels = (cssPixels: number) => (cssPixels * (devicePixelRatio || 1)) / scale;

function fit() {
  const { width, height } = windowSize();
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  if (screen.portrait) {
    scale = width / screen.width;
    left = 0;
    top = 0;
  } else {
    // A view a hair too wide is cropped; a much wider one (the window just narrowed) shrinks to fit until laid out again.
    const full = height / VIEW_HEIGHT;
    scale = screen.width * full <= width * (1 + NATIVE_TOLERANCE) ? full : width / screen.width;
    left = Math.round((width - screen.width * scale) / 2);
    top = Math.round((height - VIEW_HEIGHT * scale) / 2);
  }
  screen.left = -left / scale;
  screen.right = (width - left) / scale;
}

export function toView(clientX: number, clientY: number) {
  const ratio = devicePixelRatio || 1;
  return { x: (clientX * ratio - left) / scale, y: (clientY * ratio - top) / scale };
}

export function beginFrame() {
  fit();
  clipBottom = screen.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(scale, 0, 0, scale, left, top);
  ctx.imageSmoothingQuality = 'high';
}

// The scene is clipped to the view's own box, so its pixels don't depend on how wide the window is.
export function beginView() {
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, screen.width, screen.height);
  ctx.clip();
}

export function endFrame() {
  ctx.restore();
}

// HBC has backdrops for 4:3 and 16:9 only; other widths crop or stretch one, and a tall view zooms the 4:3 one in.
export function drawBackground(image: HTMLImageElement) {
  if (screen.portrait) {
    const columns = (screen.width * image.height) / screen.height;
    ctx.drawImage(image, (image.width - columns) / 2, 0, columns, image.height, 0, 0, screen.width, screen.height);
    return;
  }
  const first = Math.max(0, Math.floor((image.width - screen.width) / 2));
  if (image.width === screen.width) ctx.drawImage(image, 0, 0);
  else ctx.drawImage(image, first, 0, Math.min(image.width, screen.width), VIEW_HEIGHT, 0, 0, screen.width, VIEW_HEIGHT);
}

// The window can show a bit more than the view (more while the page is laid out again). The backdrop's
// edge columns carry on there, under `overlay`, the scene's dimming and fades.
export function drawEdges(image: HTMLImageElement, overlay: () => void) {
  const first = Math.max(0, Math.floor((image.width - screen.width) / 2));
  const last = first + Math.min(image.width, screen.width) - 1;
  for (const [from, to, column] of [[screen.left, 0, first], [screen.width, screen.right, last]]) {
    if (to - from <= 0) continue;
    ctx.save();
    ctx.beginPath();
    ctx.rect(from, 0, to - from, VIEW_HEIGHT);
    ctx.clip();
    ctx.drawImage(image, column, 0, 1, VIEW_HEIGHT, from, 0, to - from, VIEW_HEIGHT);
    overlay();
    ctx.restore();
  }
}

export function drawImage(image: HTMLImageElement, x: number, y: number, alpha = 1) {
  ctx.globalAlpha = alpha;
  ctx.drawImage(image, x, y);
  ctx.globalAlpha = 1;
}

// How far in from the image's left, top, right and bottom edges the part that stays as it is reaches.
export type Insets = readonly [left: number, top: number, right: number, bottom: number];

// The image at another size, with its corners and edges as drawn and only the middle stretched. The pieces
// meet on whole device pixels, so no seam shows between them at a fractional scale.
export function drawSliced(image: HTMLImageElement, x: number, y: number, width: number, height: number, insets: Insets, alpha = 1) {
  const [l, t, r, b] = insets;
  const sx = [0, l, image.width - r, image.width];
  const sy = [0, t, image.height - b, image.height];
  const dx = [x, x + l, x + width - r, x + width].map((edge) => Math.round(edge * scale + left));
  const dy = [y, y + t, y + height - b, y + height].map((edge) => Math.round(edge * scale + top));
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = alpha;
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 3; column++) {
      const [sw, sh] = [sx[column + 1] - sx[column], sy[row + 1] - sy[row]];
      const [dw, dh] = [dx[column + 1] - dx[column], dy[row + 1] - dy[row]];
      if (sw > 0 && sh > 0 && dw > 0 && dh > 0) ctx.drawImage(image, sx[column], sy[row], sw, sh, dx[column], dy[row], dw, dh);
    }
  }
  ctx.restore();
}

// Scaled and turned about its center, the way gfx.c plots bubbles and the throbber.
export function drawTurned(image: HTMLImageElement, x: number, y: number, size: number, rad: number) {
  ctx.save();
  ctx.translate(x + image.width / 2, y + image.height / 2);
  ctx.rotate(-rad); // GX turns counterclockwise, with y pointing up
  ctx.scale(size, size);
  ctx.drawImage(image, -image.width / 2, -image.height / 2);
  ctx.restore();
}

// Colors are GX's 0xRRGGBBAA.
export function fill(x: number, y: number, width: number, height: number, color: number) {
  if (!(color & 0xff)) return;
  ctx.fillStyle = `rgb(${color >>> 24} ${(color >>> 16) & 0xff} ${(color >>> 8) & 0xff} / ${(color & 0xff) / 255})`;
  ctx.fillRect(x, y, width, height);
}

export function drawText(run: TextRun, x: number, y: number) {
  const baseline = y + run.y;
  const first = run.glyphs[0];
  const last = run.glyphs[run.glyphs.length - 1];
  // Skips lines scrolled out of a memo's box, and entries that have slid off the screen.
  if (!first || baseline + 8 < clipTop || baseline - 24 > clipBottom) return;
  if (x + first.x > screen.width || x + last.x + 32 < 0) return;

  // In 16:9 the glyphs are laid out in the TV's narrower pixels, from an origin snapped to them.
  if (screen.wide) {
    const half = screen.width / 2;
    x = Math.trunc((x - half) / WIDESCREEN_RATIO) * WIDESCREEN_RATIO + half;
  }
  ctx.font = run.css;
  ctx.fillStyle = run.color ?? '#fff';
  for (const glyph of run.glyphs) ctx.fillText(glyph.ch, x + glyph.x, baseline);
  if (run.underline) ctx.fillRect(x + first.x, baseline + 2, last.x - first.x + ctx.measureText(last.ch).width, 1);
}

export function clip(x: number, y: number, width: number, height: number) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, width, height);
  ctx.clip();
  clipTop = y;
  clipBottom = y + height;
}

export function unclip() {
  ctx.restore();
  clipTop = 0;
  clipBottom = screen.height;
}
