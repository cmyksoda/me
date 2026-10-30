import type { Display } from './lyt/layout';

export const SCREEN_HEIGHT = 456;

export interface Screen extends Display {
  wide: boolean;
  /** Where the TV picture sits in the canvas, in device pixels: x, y (from the bottom), width, height. */
  viewport: [number, number, number, number];
}

/** Picks the TV the visitor's window most resembles and letterboxes the menu into it. */
export function measureScreen(canvas: HTMLCanvasElement): Screen {
  const width = Math.round(canvas.clientWidth * devicePixelRatio);
  const height = Math.round(canvas.clientHeight * devicePixelRatio);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  // 16:9 and 4:3 meet at about 1.55; a wider window gets the widescreen menu.
  const wide = width / height >= 1.55;
  const aspect = wide ? 16 / 9 : 4 / 3;
  let viewWidth = width;
  let viewHeight = Math.round(width / aspect);
  if (viewHeight > height) {
    viewHeight = height;
    viewWidth = Math.round(height * aspect);
  }
  return {
    wide,
    width: wide ? 832 : 608,
    adjustLocation: true,
    viewport: [Math.round((width - viewWidth) / 2), Math.round((height - viewHeight) / 2), viewWidth, viewHeight],
  };
}

/** How far up or down the remote still reads, in screen units: 10% past the picture, ×1.15 more on a wide TV. */
export function remoteReach(screen: Screen): number {
  return screen.wide ? 289 : 251;
}

/** Converts a mouse position (CSS pixels) to logical screen space: origin at the center, y up. */
export function toScreen(screen: Screen, canvas: HTMLCanvasElement, clientX: number, clientY: number): [number, number] {
  const rect = canvas.getBoundingClientRect();
  const [vx, vy, vw, vh] = screen.viewport;
  const px = (clientX - rect.left) * devicePixelRatio - vx;
  const py = canvas.height - (clientY - rect.top) * devicePixelRatio - vy;
  return [(px / vw - 0.5) * screen.width, (py / vh - 0.5) * SCREEN_HEIGHT];
}
