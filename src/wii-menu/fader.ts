import { SCREEN_HEIGHT, type Screen } from './display';
import type { Renderer } from './lyt/renderer';

const FRAMES = 20;
// It reports a finished fade two updates after the last step.
const DONE = FRAMES + 2;

/** The console's global fader (EGG::ColorFader): black, 20 updates each way, drawn over everything. */
export class Fader {
  private frame = DONE;
  private out = false;

  fadeIn(): void {
    this.out = false;
    this.frame = 0;
  }

  fadeOut(): void {
    this.out = true;
    this.frame = 0;
  }

  /** Clear at once, for a scene that fades itself in. */
  clear(): void {
    this.out = false;
    this.frame = DONE;
  }

  update(frames: number): void {
    this.frame = Math.min(DONE, this.frame + frames);
  }

  /** Faded in and idle (PREPARE_OUT): scenes may take input. */
  get idle(): boolean {
    return !this.out && this.frame >= DONE;
  }

  /** Faded out (PREPARE_IN): the scenes behind it can be swapped. */
  get black(): boolean {
    return this.out && this.frame >= DONE;
  }

  draw(renderer: Renderer, screen: Screen): void {
    const step = Math.floor((Math.min(FRAMES, this.frame) * 255) / FRAMES);
    const alpha = this.out ? step : 255 - step;
    if (alpha <= 0) return;
    const half = screen.window / 2;
    renderer.fill([-half, SCREEN_HEIGHT / 2, half, -SCREEN_HEIGHT / 2], [0, 0, 0, alpha]);
  }
}
