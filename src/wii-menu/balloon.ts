import type { Archive } from './assets';
import type { Screen } from './display';
import { measureText } from './lyt/font';
import { AnimationPlayer, identity, type LayoutInstance } from './lyt/layout';
import type { Renderer } from './lyt/renderer';
import type { Sound } from './sound';

const MAX_CHARACTERS = 20;
const MAX_WIDTH = 391.5;
const CUT_WIDTH = 390.32;

type State = 'hidden' | 'waiting' | 'in' | 'shown' | 'out';

/**
 * A name balloon (my_IplTopBalloon_a), shared by channel tiles and footer buttons.
 * Channel balloons queue a leave until they finish appearing; footer balloons reverse mid-clip.
 */
export class Balloon {
  private readonly instance: LayoutInstance;
  private readonly clip: AnimationPlayer;
  private state: State = 'hidden';
  private wait = 0;
  private queued: 'in' | 'out' | null = null;
  private text = '';

  constructor(
    archive: Archive,
    private readonly sound: Sound,
    private readonly delay: number,
    private readonly reverses: boolean,
  ) {
    this.instance = archive.instance('my_IplTopBalloon_a');
    this.clip = new AnimationPlayer(archive.animation('my_IplTopBalloon_a_BalloonInOut')!, this.instance);
    this.instance.pane('N_Balloon').visible = false;
  }

  get visible(): boolean {
    return this.state !== 'hidden' && this.state !== 'waiting';
  }

  /** Sets the label with the menu's truncation: 20 characters, then "..." until it fits; `whole` skips it (bNoLimit). */
  setText(renderer: Renderer, label: string, whole = false): void {
    const pane = this.instance.pane('T_Balloon');
    const content = pane.source.text!;
    const font = renderer.fonts.get(this.instance.layout.fonts[content.font].replace(/\.brfn[ta]$/, ''))!.metrics;
    let text = whole ? label : label.slice(0, MAX_CHARACTERS);
    let limit = whole ? Infinity : MAX_WIDTH;
    while (text.length > 0 && measureText(font, content, text) > limit) {
      text = `${text.replace(/\.\.\.$/, '').slice(0, -1)}...`;
      limit = CUT_WIDTH;
    }
    this.text = text;
    pane.text = text;
    const width = measureText(font, content, text) + 40;
    this.instance.pane('W_Base').size[0] = width;
    this.instance.pane('W_Shade').size[0] = width;
  }

  point(): void {
    if (this.state === 'hidden') {
      this.state = 'waiting';
      this.wait = 0;
    } else if (this.state === 'out') {
      if (this.reverses) this.start('in');
      else this.queued = 'in';
    } else if (this.state === 'in') {
      this.queued = null;
    }
  }

  leave(): void {
    if (this.state === 'waiting') this.state = 'hidden';
    else if (this.state === 'in') {
      if (this.reverses) this.start('out');
      else this.queued = 'out';
    } else if (this.state === 'shown') this.start('out');
  }

  hideNow(): void {
    this.state = 'hidden';
    this.queued = null;
    this.instance.pane('N_Balloon').visible = false;
  }

  private start(direction: 'in' | 'out'): void {
    this.state = direction;
    this.queued = null;
    this.instance.pane('N_Balloon').visible = true;
    // A reversing balloon turns around from wherever its clip is.
    const frame = this.clip.frame;
    this.clip.play(direction === 'out');
    if (this.reverses) this.clip.frame = frame;
    if (direction === 'in') this.sound.play('WIPL_SE_BALLOON');
  }

  update(frames: number): void {
    if (this.state === 'waiting' && (this.wait += frames) >= this.delay) {
      this.clip.frame = this.clip.from;
      this.start('in');
    }
    this.clip.step(frames);
    if (this.clip.playing) return;
    if (this.state === 'in') {
      this.state = 'shown';
      if (this.queued === 'out') this.start('out');
    } else if (this.state === 'out') {
      this.hideNow();
      if (this.queued === 'in') this.point();
    }
  }

  /**
   * Draws with its tail centered at (x, y), keeping `margin` units inside the screen edges. A footer
   * balloon's clamped x sits under its layout's stretched root, so in 16:9 it lands L times further out.
   */
  draw(renderer: Renderer, screen: Screen, x: number, y: number, margin: number, underRoot = false): void {
    if (!this.visible) return;
    const minimum = 160 * (screen.width / 608);
    const base = this.instance.pane('W_Base');
    if (base.size[0] < minimum) {
      base.size[0] = minimum;
      this.instance.pane('W_Shade').size[0] = minimum;
    }
    const half = base.size[0] / 2;
    const edge = screen.width / 2 - margin;
    const shifted = Math.min(edge - half, Math.max(-edge + half, x));
    const view = identity();
    view[3] = underRoot ? shifted * (screen.width / 608) : shifted;
    view[7] = y;
    this.instance.update(view, screen);
    renderer.drawLayout(this.instance);
  }

  get label(): string {
    return this.text;
  }
}
