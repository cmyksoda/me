// The TV: a canvas over the whole window, drawn at the device's own resolution (gfx.c).

import type { TextRun } from './font';

export const VIEW_HEIGHT = 480;
export const WIDESCREEN_RATIO = 852 / 640;

const WIDTH_4_3 = 640;
export const WIDTH_16_9 = 852;
// Windows this close to 4:3 or 16:9 get exactly the console's layout, which was matched pixel for pixel.
const NATIVE_TOLERANCE = 0.005;

// width is the view's size in HBC pixels; left and right are where the window's edges fall in them.
export const screen = { wide: true, width: WIDTH_16_9, left: 0, right: WIDTH_16_9 };

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

// Text is laid out for 16:9 once the window is closer to it than to 4:3. Windows narrower than 4:3 stay 4:3, letterboxed.
export function windowLayout() {
  const { width, height } = windowSize();
  const aspect = height > 0 ? width / height : 0;
  const near = (ratio: number) => Math.abs(aspect / ratio - 1) < NATIVE_TOLERANCE;
  let viewWidth = WIDTH_4_3;
  if (near(16 / 9)) viewWidth = WIDTH_16_9;
  else if (!near(4 / 3)) viewWidth = Math.max(WIDTH_4_3, Math.floor(VIEW_HEIGHT * aspect + 1e-6));
  return { wide: aspect >= Math.sqrt((4 / 3) * (16 / 9)), width: viewWidth };
}

export function setLayout(layout: { wide: boolean; width: number }) {
  screen.wide = layout.wide;
  screen.width = layout.width;
}

function fit() {
  const { width, height } = windowSize();
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  // A view a hair too wide is cropped; a much wider one (the window just narrowed) shrinks to fit until laid out again.
  const full = height / VIEW_HEIGHT;
  scale = screen.width * full <= width * (1 + NATIVE_TOLERANCE) ? full : width / screen.width;
  left = Math.round((width - screen.width * scale) / 2);
  top = Math.round((height - VIEW_HEIGHT * scale) / 2);
  screen.left = -left / scale;
  screen.right = (width - left) / scale;
}

export function toView(clientX: number, clientY: number) {
  const ratio = devicePixelRatio || 1;
  return { x: (clientX * ratio - left) / scale, y: (clientY * ratio - top) / scale };
}

export function beginFrame() {
  fit();
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
  ctx.rect(0, 0, screen.width, VIEW_HEIGHT);
  ctx.clip();
}

export function endFrame() {
  ctx.restore();
}

// HBC has backdrops for 4:3 and 16:9 only; other widths crop or stretch one.
export function drawBackground(image: HTMLImageElement) {
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
  clipBottom = VIEW_HEIGHT;
}
