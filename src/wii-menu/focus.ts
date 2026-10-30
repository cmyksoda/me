import type { Archive } from './assets';
import type { Screen } from './display';
import { translation } from './grid';
import { AnimationPlayer, type LayoutInstance } from './lyt/layout';
import type { Renderer } from './lyt/renderer';

type State = 'hidden' | 'in' | 'held' | 'out';

/**
 * A tile's hover frame (my_IplTop_d, ChannelObj::setCursorAnim): FocusOn and FocusOff never reverse
 * mid-way, so a change of mind waits for the running clip to finish.
 */
export class FocusFrame {
  private readonly instance: LayoutInstance;
  private readonly on: AnimationPlayer;
  private readonly off: AnimationPlayer;
  private state: State = 'hidden';
  private queued: 'in' | 'out' | null = null;

  constructor(archive: Archive) {
    this.instance = archive.instance('my_IplTop_d');
    this.on = new AnimationPlayer(archive.animation('my_IplTop_d_FocusOn')!, this.instance);
    this.off = new AnimationPlayer(archive.animation('my_IplTop_d_FocusOff')!, this.instance);
    this.hide();
  }

  point(): void {
    if (this.state === 'hidden') {
      this.state = 'in';
      this.on.play();
    } else {
      this.queued = this.state === 'out' ? 'in' : null;
    }
  }

  leave(): void {
    if (this.state === 'held') {
      this.state = 'out';
      this.off.play();
    } else if (this.state === 'in') {
      this.queued = 'out';
    }
  }

  /** Gone at once, as when the grid leaves its normal state or the tile is chosen (Select). */
  hide(): void {
    this.state = 'hidden';
    this.queued = null;
    this.instance.pane('Cursur_a').visible = false;
  }

  update(frames: number): void {
    const clip = this.state === 'in' ? this.on : this.state === 'out' ? this.off : null;
    if (!clip) return;
    clip.step(frames);
    if (clip.playing) return;
    const queued = this.queued;
    this.queued = null;
    if (this.state === 'in') {
      this.state = 'held';
      if (queued === 'out') this.leave();
    } else {
      this.hide();
      if (queued === 'in') this.point();
    }
  }

  draw(renderer: Renderer, screen: Screen, x: number, y: number): void {
    if (this.state === 'hidden') return;
    (this.state === 'out' ? this.off : this.on).apply();
    this.instance.update(translation(x, y), screen);
    renderer.drawLayout(this.instance);
  }
}
