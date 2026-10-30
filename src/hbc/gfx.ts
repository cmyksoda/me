// The TV: a canvas over the whole window, drawn at the device's own resolution (gfx.c).

import type { TextRun } from './font';

export const VIEW_HEIGHT = 480;
export const WIDESCREEN_RATIO = 852 / 640;

export const screen = { wide: true, width: 852 };

const canvas = document.querySelector<HTMLCanvasElement>('#tv')!;
const ctx = canvas.getContext('2d', { alpha: false })!;
let scale = 1;
let left = 0;
let top = 0;
let clipTop = 0;
let clipBottom = VIEW_HEIGHT;

// Widescreen once the window is closer to 16:9 than to 4:3.
export function prefersWide() {
  return innerWidth / innerHeight >= Math.sqrt((4 / 3) * (16 / 9));
}

export function setWidescreen(wide: boolean) {
  screen.wide = wide;
  screen.width = wide ? 852 : 640;
}

function fit() {
  const ratio = devicePixelRatio || 1;
  const width = Math.round(innerWidth * ratio);
  const height = Math.round(innerHeight * ratio);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  scale = Math.min(width / screen.width, height / VIEW_HEIGHT);
  left = Math.round((width - screen.width * scale) / 2);
  top = Math.round((height - VIEW_HEIGHT * scale) / 2);
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
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, screen.width, VIEW_HEIGHT);
  ctx.clip();
}

export function endFrame() {
  ctx.restore();
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
