import type { Display } from './lyt/layout';

export const SCREEN_HEIGHT = 456;
const STANDARD = 4 / 3;
const WIDE = 16 / 9;
// Past 32:9 the menu is pillarboxed.
const WIDEST = 32 / 9;
// The console's two projections, 608 and 832 units wide; between them, a window gets one of its own.
const PROJECTION_STANDARD = 608;
const PROJECTION_WIDE = 832;
// A 16:9 TV spreads its 832 units over 16/9 of its height; a wider window keeps that unit width.
const WIDE_UNITS_PER_HEIGHT = (PROJECTION_WIDE * 9) / 16;
// The 16:9 textures misshape their corners less than the 4:3 ones past the projections' geometric mean.
const WIDE_TEXTURES_FROM = Math.sqrt(PROJECTION_STANDARD * PROJECTION_WIDE);

export interface Screen extends Display {
  /** The 16:9 donor textures replace the 4:3 ones. */
  wide: boolean;
  /** The console's own picture, centered in the window: banners, icons and the grid stay inside its stretch. */
  tv: Display;
  /** Where the TV picture sits in the canvas, in device pixels: x, y (from the bottom), width, height. */
  viewport: [number, number, number, number];
}

/**
 * Fills any landscape window from 4:3 to 32:9. Up to 16:9 the projection widens with the window, as
 * the console's location adjust would; past it, the 16:9 picture stays and the window shows more around it.
 */
export function measureScreen(canvas: HTMLCanvasElement): Screen {
  const width = Math.round(canvas.clientWidth * devicePixelRatio);
  const height = Math.round(canvas.clientHeight * devicePixelRatio);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const aspect = width / height;
  let logical: number;
  let viewport: Screen['viewport'];
  if (aspect < STANDARD) {
    const viewHeight = Math.round(width / STANDARD);
    logical = PROJECTION_STANDARD;
    viewport = [0, Math.round((height - viewHeight) / 2), width, viewHeight];
  } else if (aspect > WIDEST) {
    const viewWidth = Math.round(height * WIDEST);
    logical = WIDE_UNITS_PER_HEIGHT * WIDEST;
    viewport = [Math.round((width - viewWidth) / 2), 0, viewWidth, height];
  } else {
    // 4:3 and 16:9 windows land on exactly 608 and 832 units.
    logical = aspect < WIDE
      ? PROJECTION_STANDARD + ((aspect - STANDARD) * (PROJECTION_WIDE - PROJECTION_STANDARD)) / (WIDE - STANDARD)
      : (WIDE_UNITS_PER_HEIGHT * width) / height;
    viewport = [0, 0, width, height];
  }
  const projection = Math.min(logical, PROJECTION_WIDE);
  return {
    wide: projection >= WIDE_TEXTURES_FROM,
    width: logical,
    projection,
    adjustLocation: true,
    tv: { width: projection, projection, adjustLocation: true },
    viewport,
  };
}

/** A constant the console keeps per TV mode, followed across the projections between them. */
export function perMode(screen: Display, standard: number, wide: number): number {
  return standard + ((wide - standard) * (screen.projection - PROJECTION_STANDARD)) / (PROJECTION_WIDE - PROJECTION_STANDARD);
}

/** How far the footer pod on x's side (flagged at x −293 or 294) moves out on a window wider than the projection. */
export function podShift(screen: Display, x: number): number {
  return ((x < 0 ? -293 : 294) * (screen.width - screen.projection)) / PROJECTION_STANDARD;
}

/** Converts a mouse position (CSS pixels) to logical screen space: origin at the center, y up. */
export function toScreen(screen: Screen, canvas: HTMLCanvasElement, clientX: number, clientY: number): [number, number] {
  const rect = canvas.getBoundingClientRect();
  const [vx, vy, vw, vh] = screen.viewport;
  const px = (clientX - rect.left) * devicePixelRatio - vx;
  const py = canvas.height - (clientY - rect.top) * devicePixelRatio - vy;
  return [(px / vw - 0.5) * screen.width, (py / vh - 0.5) * SCREEN_HEIGHT];
}
