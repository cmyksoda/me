import type { Archive } from './assets';
import type { Screen } from './display';
import { AnimationPlayer, identity, type LayoutInstance } from './lyt/layout';
import type { Renderer } from './lyt/renderer';

/**
 * The SD card's message panel (mn_Nocard), here only with its spinner: "Loading from the SD Card..."
 * comes in on IN_02, the spinner turns once it is in, and OUT_02 takes it away.
 */
export class CardPanel {
  /** Updates since the panel finished coming in (the 1-second gate's clock), or null before then. */
  held: number | null = null;
  private readonly instance: LayoutInstance;
  private readonly enter: AnimationPlayer;
  private readonly exit: AnimationPlayer;
  private readonly spinner: AnimationPlayer;
  private shown = false;
  private closing = false;

  constructor(archive: Archive, message: string) {
    this.instance = archive.instance('mn_Nocard');
    const groups = this.instance.layout.groups;
    const clip = (file: string, group: string, loop = false) => new AnimationPlayer(
      archive.animation(file)!, this.instance, { panes: groups.get(group), loop },
    );
    this.enter = clip('mn_Nocard_IN_02', 'Group_01').seek(0);
    // The code asks for mn_Nocard_Out_02; the archive spells it in capitals and U8 lookups ignore case.
    this.exit = clip('mn_Nocard_OUT_02', 'Group_01');
    this.spinner = clip('mn_Nocard_Wait', 'G_Wait', true);
    this.instance.pane('T_TimerMes_01').text = message;
  }

  /** No clip is coming in or going out; the spinner may still turn. */
  get idle(): boolean {
    return !this.enter.playing && !this.exit.playing;
  }

  /** Request 8: the message with the spinner. */
  show(): void {
    this.shown = true;
    this.closing = false;
    this.held = null;
    this.enter.play();
  }

  /** Request 1: the spinner stops where it is and the panel goes. */
  close(): void {
    this.closing = true;
    this.held = null;
    this.spinner.playing = false;
    this.exit.play();
  }

  update(frames: number): void {
    if (!this.shown) return;
    this.enter.step(frames);
    this.exit.step(frames);
    this.spinner.step(frames);
    if (this.closing) {
      if (!this.exit.playing) this.shown = false;
    } else if (this.held !== null) {
      this.held += frames;
    } else if (!this.enter.playing) {
      this.held = 0;
      this.spinner.play();
    }
  }

  draw(renderer: Renderer, screen: Screen): void {
    if (!this.shown) return;
    this.instance.update(identity(), screen);
    renderer.drawLayout(this.instance);
  }
}
