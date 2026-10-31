import type { Archive } from './assets';
import type { Screen } from './display';
import { contains } from './lyt/hit';
import { AnimationPlayer, identity, type LayoutInstance, type PaneNode } from './lyt/layout';
import type { Renderer } from './lyt/renderer';
import type { MenuPointer } from './menu';
import type { Sound } from './sound';
import { cover } from './wide';

type State = 'ready' | 'in' | 'normal' | 'select' | 'out';

/** The system dialog with one button (iplDialogWindow.cpp's callBtn1): my_DialogWindow_a1. */
export class Dialog {
  private readonly instance: LayoutInstance;
  private readonly clips: Record<'in' | 'out' | 'on' | 'off' | 'select', AnimationPlayer>;
  private readonly button: PaneNode;
  private state: State = 'ready';
  private onClose: (() => void) | null = null;
  private pointed = false;
  private hovered = false;

  constructor(archive: Archive, private readonly sound: Sound) {
    const name = 'my_DialogWindow_a1';
    const instance = archive.instance(name);
    const clip = (file: string, group: string) => new AnimationPlayer(
      archive.animation(`${name}_${file}`)!, instance, { panes: instance.layout.groups.get(group) },
    );
    this.instance = instance;
    // Bind order decides which clip wins a shared pane; update steps them in this order.
    this.clips = {
      in: clip('DialogIn', 'G_InOut'),
      out: clip('DialogOut', 'G_InOut'),
      on: clip('FocusBtn_on', 'G_FocusBtnB'),
      off: clip('FocusBtn_off', 'G_FocusBtnB'),
      select: clip('SelectBtn_Ac', 'G_SelectBtnB'),
    };
    this.button = instance.pane('B_BtnB');
    // finishBinding leaves the window below the screen until a call brings it in.
    this.clips.in.seek(0);
  }

  get busy(): boolean {
    return this.state !== 'ready';
  }

  /** callBtn1: a message and one button. */
  openOne(message: string, button: string, onClose: () => void): void {
    this.onClose = onClose;
    this.pointed = this.hovered = false;
    this.clips.on.seek(0);
    this.instance.pane('T_Dialog').text = message;
    this.instance.pane('T_BtnB').text = button;
    this.clips.in.play();
    this.state = 'in';
    this.sound.play('WIPL_SE_INFO_WINDOW');
  }

  /** The GUI's pointer events: entering and leaving the button, then the A trigger in NORMAL. */
  private updateButton(pointer: MenuPointer): void {
    const inside = pointer.inside && contains(this.button, pointer.x, pointer.y);
    if (inside !== this.pointed) {
      this.pointed = inside;
      if (inside && !this.hovered) {
        this.hovered = true;
        this.sound.play('WIPL_SE_BT_TARGETTING');
        this.clips.on.play();
      } else if (!inside && this.hovered) {
        this.hovered = false;
        this.clips.off.play();
      }
    }
    if (pointer.aPressed && this.pointed) {
      this.clips.select.play();
      this.sound.play('WIPL_SE_DECIDE');
      this.state = 'select';
    }
  }

  update(frames: number, pointer: MenuPointer): void {
    if (this.state === 'ready') return;
    const clips = this.clips;
    if (this.state === 'in' && !clips.in.playing) this.state = 'normal';
    if (this.state === 'normal') this.updateButton(pointer);
    if (this.state === 'select' && !clips.select.playing) {
      clips.out.play();
      this.state = 'out';
    } else if (this.state === 'out' && !clips.out.playing) {
      this.state = 'ready';
      this.onClose?.();
      return;
    }
    for (const clip of Object.values(clips)) clip.step(frames);
  }

  draw(renderer: Renderer, screen: Screen): void {
    if (this.state === 'ready') return;
    const shade = this.instance.panes.get('Shade');
    if (shade) cover(shade, screen);
    this.instance.update(identity(), screen);
    renderer.drawLayout(this.instance);
  }
}
