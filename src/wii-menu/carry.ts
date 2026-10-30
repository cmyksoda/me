import type { Archive } from './assets';
import type { Screen } from './display';
import { AnimationPlayer, identity, type LayoutInstance } from './lyt/layout';
import type { Renderer } from './lyt/renderer';

const GRAB_FRAMES = 10;
const DWELL_FRAMES = 15;
const REFUSED_VEIL_FRAMES = 21;

interface Overlay {
  instance: LayoutInstance;
  appear: AnimationPlayer;
  lost: AnimationPlayer;
}

function translation(x: number, y: number) {
  const m = identity();
  m[3] = x;
  m[7] = y;
  return m;
}

/**
 * Carrying a channel (ChannelSelect's GRAB/DRAG states): gray veils on the occupied slots, static
 * on the one it came from, a blue TV silhouette under the hand, and the TV flash where it lands.
 */
export class Carry {
  active = false;
  source = -1;
  private held = 0;
  private x = 0;
  private y = 0;
  private readonly veil: Overlay;
  private readonly shade: Overlay;
  private readonly flash: Overlay;
  private readonly empty: LayoutInstance;
  private readonly emptyClip: AnimationPlayer;
  private target: number | null = null;
  private onLanded: (() => void) | null = null;
  private moved = false;
  private veilHold = 0;
  private dwelling: { side: 'left' | 'right' | null; frames: number } = { side: null, frames: 0 };
  private wide: boolean | null = null;

  constructor(private readonly archive: Archive) {
    const overlay = (name: string): Overlay => {
      const instance = archive.instance(name);
      return {
        instance,
        appear: new AnimationPlayer(archive.animation(`${name}_Apear`)!, instance),
        lost: new AnimationPlayer(archive.animation(`${name}_Lost`)!, instance),
      };
    };
    this.veil = overlay('my_TVMask_a');
    this.shade = overlay('my_TVShade_a');
    this.flash = overlay('my_TVApear_a');
    this.empty = archive.instance('my_IplTop_b');
    this.emptyClip = new AnimationPlayer(archive.animation('my_IplTop_b')!, this.empty, { loop: true }).play();
  }

  start(source: number): void {
    this.active = true;
    this.source = source;
    this.held = 0;
    this.target = null;
    this.moved = false;
    this.veilHold = 0;
    this.dwelling = { side: null, frames: 0 };
    this.veil.appear.play();
    this.shade.appear.play();
    this.emptyClip.frame = Math.floor(Math.random() * 2000) % this.emptyClip.to;
  }

  /** The first 10 updates are the pick-up; a release then waits until carrying has begun. */
  get ready(): boolean {
    return this.held >= GRAB_FRAMES;
  }

  follow(x: number, y: number): void {
    this.x = x;
    this.y = y;
  }

  /** Counts updates spent resting on one page arrow; true when it should turn the page. */
  dwell(side: 'left' | 'right' | null, frames: number): boolean {
    if (side !== this.dwelling.side) this.dwelling = { side, frames: 0 };
    if (!side) return false;
    this.dwelling.frames += frames;
    if (this.dwelling.frames < DWELL_FRAMES) return false;
    this.dwelling.frames = 0;
    return true;
  }

  /** A legal drop: the TV flash switches on over the target, then the channel moves in under it. */
  land(target: number, move: () => void): void {
    this.active = false;
    this.target = target;
    this.onLanded = move;
    this.flash.appear.play();
    this.veil.lost.play();
    this.shade.lost.play();
  }

  /** An illegal drop: the channel stays home and the veils linger 21 updates before fading. */
  refuse(): void {
    this.active = false;
    this.target = null;
    this.veilHold = REFUSED_VEIL_FRAMES;
    this.shade.lost.play();
  }

  get busy(): boolean {
    return this.active || this.veilHold > 0 || this.target !== null
      || [this.veil, this.shade, this.flash].some((o) => o.appear.playing || o.lost.playing);
  }

  update(frames: number): void {
    if (this.active) this.held += frames;
    this.emptyClip.step(frames);
    for (const overlay of [this.veil, this.shade, this.flash]) {
      overlay.appear.step(frames);
      overlay.lost.step(frames);
    }
    if (this.veilHold > 0) {
      this.veilHold -= frames;
      if (this.veilHold <= 0) this.veil.lost.play();
    }
    if (this.target !== null && !this.moved && !this.flash.appear.playing) {
      this.moved = true;
      this.onLanded?.();
      this.flash.lost.play();
    }
    if (this.target !== null && this.moved && !this.flash.lost.playing) this.target = null;
  }

  /** Drag overlays for one slot, drawn with its thumbnail so the tile frames still sit on top. */
  drawSlot(renderer: Renderer, screen: Screen, absolute: number, occupied: boolean, x: number, y: number): void {
    const veiling = this.active || this.veilHold > 0 || this.veil.lost.playing;
    if (veiling && occupied && absolute !== this.source) {
      (this.veil.lost.playing ? this.veil.lost : this.veil.appear).apply();
      this.veil.instance.update(translation(x, y), screen);
      renderer.drawLayout(this.veil.instance);
    }
    if (absolute === this.source && (this.active || (this.target !== null && !this.moved))) {
      this.empty.update(translation(x, y), screen);
      renderer.drawLayout(this.empty);
    }
    if (absolute === this.target) {
      (this.moved ? this.flash.lost : this.flash.appear).apply();
      this.flash.instance.update(translation(x, y), screen);
      renderer.drawLayout(this.flash.instance);
    }
  }

  /** The carried tile, above the grid and footer but under the arrows and the hand. */
  drawTile(renderer: Renderer, screen: Screen): void {
    if (!this.active && !this.shade.lost.playing) return;
    if (screen.wide !== this.wide) this.useWideTile(screen.wide);
    (this.shade.lost.playing ? this.shade.lost : this.shade.appear).apply();
    this.shade.instance.update(translation(this.x, this.y), screen);
    renderer.drawLayout(this.shade.instance);
  }

  /** createChanMoveLayout copies the 16:9 silhouette into both panes on a widescreen TV. */
  private useWideTile(wide: boolean): void {
    this.wide = wide;
    const materials = this.shade.instance.materials;
    const texture = (pane: string) => materials[this.shade.instance.pane(pane).source.picture!.material];
    const original = this.archive.layout('my_TVShade_a').textures;
    for (const pane of ['4x3', '4x3_dummy']) {
      const material = texture(pane);
      material.textures[0] = wide
        ? texture('16x9').textures[0]
        : original[material.source.texMaps[0].texture];
    }
  }
}
