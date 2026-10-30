import type { Archive } from './assets';
import type { Screen } from './display';
import { contains } from './lyt/hit';
import { AnimationPlayer, identity, type LayoutInstance, type PaneNode } from './lyt/layout';
import type { Renderer } from './lyt/renderer';
import type { MenuPointer } from './menu';
import type { Sound } from './sound';
import { cover } from './wide';

/** A picture a page shows over the dialog (the spinner, the "?" button), with its clip if it moves. */
export interface DialogPicture {
  instance: LayoutInstance;
  clip: AnimationPlayer | null;
  /** Height above the window's center (the page table's layoutYOff). */
  y: number;
}

export interface DialogPage {
  message: string;
  right: string;
  /** Null for a page without a left button (isTwoBtn false). */
  left: string | null;
  picture?: DialogPicture;
}

export type DialogResult = 'left' | 'right';

type State = 'ready' | 'in' | 'normal' | 'select' | 'out' | 'prepare' | 'fade';

interface DialogLayout {
  instance: LayoutInstance;
  clips: Record<string, AnimationPlayer>;
  /** B_BtnB is the right (or only) button, B_BtnA the left one. */
  buttons: Partial<Record<DialogResult, PaneNode>>;
}

const FADE_DELAY = 10;

/** Sets the alpha of everything under a pane, as set_alpha does; the pane keeps its own. */
function setAlpha(pane: PaneNode, alpha: number): void {
  for (const child of pane.children) {
    child.alpha = alpha;
    setAlpha(child, alpha);
  }
}

/**
 * The system dialog (iplDialogWindow.cpp): my_DialogWindow_a1 with one button, or my_DialogWindow_a2
 * with two, whose pages turn by fading the old page's text out and the next page's in.
 */
export class Dialog {
  private readonly layouts: Record<'one' | 'two', DialogLayout>;
  private current: DialogLayout | null = null;
  private state: State = 'ready';
  private result: DialogResult = 'right';
  private onClose: ((result: DialogResult) => void) | null = null;
  private pages: DialogPage[] = [];
  private page = 0;
  private previous = 0;
  private picture: DialogPicture | null = null;
  private alpha = 255;
  private fadingOut = false;
  private readonly pointed = new Set<DialogResult>();
  private readonly hovered = new Set<DialogResult>();

  constructor(archive: Archive, private readonly sound: Sound) {
    const build = (name: string, buttons: DialogResult[]): DialogLayout => {
      const instance = archive.instance(name);
      const clip = (file: string, group: string) => new AnimationPlayer(
        archive.animation(`${name}_${file}`)!, instance, { panes: instance.layout.groups.get(group) },
      );
      // Bind order decides which clip wins a shared pane; update steps them in this order.
      const clips: Record<string, AnimationPlayer> = { in: clip('DialogIn', 'G_InOut'), out: clip('DialogOut', 'G_InOut') };
      const panes: Partial<Record<DialogResult, PaneNode>> = {};
      for (const button of buttons) {
        const side = button === 'right' ? 'B' : 'A';
        clips[`${button}On`] = clip('FocusBtn_on', `G_FocusBtn${side}`);
        clips[`${button}Off`] = clip('FocusBtn_off', `G_FocusBtn${side}`);
        clips[`${button}Select`] = clip('SelectBtn_Ac', `G_SelectBtn${side}`);
        panes[button] = instance.pane(`B_Btn${side}`);
      }
      // finishBinding leaves the window below the screen until a call brings it in.
      clips.in.seek(0);
      return { instance, clips, buttons: panes };
    };
    this.layouts = { one: build('my_DialogWindow_a1', ['right']), two: build('my_DialogWindow_a2', ['right', 'left']) };
  }

  get busy(): boolean {
    return this.state !== 'ready';
  }

  /** callBtn1: a message and one button. */
  openOne(message: string, button: string, onClose: (result: DialogResult) => void): void {
    this.call(this.layouts.one, [{ message, right: button, left: null }], onClose);
  }

  /** callBtn2Multi: the right button turns forward, the left one back; turning past either end closes. */
  openPages(pages: DialogPage[], onClose: (result: DialogResult) => void): void {
    this.call(this.layouts.two, pages, onClose);
    this.layouts.two.instance.pane('N_BtnA').visible = pages[0].left !== null;
  }

  private call(layout: DialogLayout, pages: DialogPage[], onClose: (result: DialogResult) => void): void {
    this.current = layout;
    this.pages = pages;
    this.page = this.previous = 0;
    this.picture = pages[0].picture ?? null;
    this.alpha = 255;
    this.onClose = onClose;
    this.pointed.clear();
    this.hovered.clear();
    layout.clips.rightOn.seek(0);
    layout.clips.leftOn?.seek(0);
    this.setTexts(pages[0]);
    layout.clips.in.play();
    this.state = 'in';
    this.sound.play('WIPL_SE_INFO_WINDOW');
  }

  private setTexts(page: DialogPage): void {
    const instance = this.current!.instance;
    instance.pane('T_Dialog').text = page.message;
    instance.pane('T_BtnB').text = page.right;
    if (page.left !== null) instance.pane('T_BtnA').text = page.left;
  }

  /** The left button comes or goes with this page turn. */
  private get leftChanges(): boolean {
    return (this.pages[this.page].left !== null) !== (this.pages[this.previous].left !== null);
  }

  /** The GUI's pointer events: entering and leaving each button, then the A trigger in NORMAL. */
  private updateButtons(pointer: MenuPointer): void {
    const current = this.current!;
    const turning = this.state === 'prepare' || this.state === 'fade';
    for (const button of ['right', 'left'] as const) {
      const pane = current.buttons[button];
      const inside = pointer.inside && pane !== undefined && contains(pane, pointer.x, pointer.y);
      if (inside === this.pointed.has(button)) continue;
      if (inside) this.pointed.add(button);
      else this.pointed.delete(button);
      // A left button fading in or out ignores the pointer until the page has turned.
      if (turning && button === 'left' && this.leftChanges) continue;
      if (inside && !this.hovered.has(button)) {
        this.hovered.add(button);
        this.sound.play('WIPL_SE_BT_TARGETTING');
        current.clips[`${button}On`].play();
      } else if (!inside && this.hovered.has(button)) {
        this.hovered.delete(button);
        current.clips[`${button}Off`].play();
      }
    }
    const pressed = (['right', 'left'] as const).find((button) => this.pointed.has(button));
    if (this.state === 'normal' && pointer.aPressed && pressed) this.press(pressed);
  }

  private press(button: DialogResult): void {
    this.result = button;
    this.current!.clips[`${button}Select`].play();
    this.sound.play(button === 'right' ? 'WIPL_SE_DECIDE' : 'WIPL_SE_CANCEL');
    this.previous = this.page;
    this.page += button === 'right' ? 1 : -1;
    const clip = this.pages[this.previous].picture?.clip;
    if (clip) clip.playing = false;
    if (this.page < 0 || this.page === this.pages.length) {
      this.page = this.previous;
      this.state = 'select';
    } else {
      this.state = 'prepare';
      this.fadingOut = true;
    }
  }

  /** stt_pagefade, one step of 26 alpha per update each way. */
  private turnPage(frames: number): void {
    const current = this.current!;
    const instance = current.instance;
    const now = this.pages[this.page];
    const before = this.pages[this.previous];
    const speed = Math.ceil(255 / FADE_DELAY) * frames;
    this.alpha = Math.max(0, Math.min(255, this.alpha + (this.fadingOut ? -speed : speed)));
    const alpha = Math.round(this.alpha);
    instance.pane('T_Dialog').alpha = alpha;
    // The page on show: the old one while fading out, the new one while fading in.
    const shown = this.fadingOut ? before : now;
    if (this.leftChanges && shown.left !== null) {
      instance.pane('N_BtnA').visible = alpha > 0;
      setAlpha(instance.pane('N_BtnA_Pic'), alpha > 0 ? alpha : 255);
      if (alpha === 0 || (!this.fadingOut && alpha === 255)) {
        this.hovered.delete('left');
        current.clips.leftOn.seek(0);
      }
    } else if (now.left !== before.left) {
      instance.pane('T_BtnA').alpha = alpha;
    }
    if (now.right !== before.right) instance.pane('T_BtnB').alpha = alpha;
    const picture = shown.picture;
    if (now.picture !== before.picture && picture) {
      setAlpha(picture.instance.root, this.fadingOut && alpha === 0 ? 255 : alpha);
      if (this.fadingOut && alpha === 0) picture.clip?.seek(picture.clip.from);
      if (!this.fadingOut && alpha === 255) picture.clip?.play();
    }
    if (this.fadingOut && alpha === 0) {
      this.fadingOut = false;
      this.setTexts(now);
      this.picture = now.picture ?? null;
    } else if (!this.fadingOut && alpha === 255) {
      this.state = 'normal';
    }
  }

  update(frames: number, pointer: MenuPointer): void {
    const current = this.current;
    if (!current) return;
    const clips = current.clips;
    if (this.state === 'in' && !clips.in.playing) this.state = 'normal';
    if (this.state === 'normal' || this.state === 'prepare' || this.state === 'fade') this.updateButtons(pointer);
    if (this.state === 'prepare' && !clips.rightSelect.playing && !clips.leftSelect?.playing) {
      // The select flash ends small, so a button still under the pointer grows back.
      if (this.result === 'right' && this.hovered.has('right')) clips.rightOn.play();
      if (this.result === 'left' && this.hovered.has('left') && this.pages[this.page].left !== null) clips.leftOn.play();
      this.state = 'fade';
    } else if (this.state === 'fade') {
      this.turnPage(frames);
    } else if (this.state === 'select' && !clips[`${this.result}Select`].playing) {
      clips.out.play();
      this.state = 'out';
    } else if (this.state === 'out' && !clips.out.playing) {
      this.state = 'ready';
      this.current = null;
      this.onClose?.(this.result);
      return;
    }
    for (const clip of Object.values(clips)) clip.step(frames);
    this.picture?.clip?.step(frames);
  }

  draw(renderer: Renderer, screen: Screen): void {
    const current = this.current;
    if (!current) return;
    const shade = current.instance.panes.get('Shade');
    if (shade) cover(shade, screen);
    current.instance.update(identity(), screen);
    renderer.drawLayout(current.instance);
    const picture = this.picture;
    if (!picture || (this.state === 'fade' && Math.round(this.alpha) === 0)) return;
    // The picture rides with the window as it slides in and out.
    const [x, y] = current.instance.pane('N_Dialog').translate;
    const view = identity();
    view[3] = x;
    view[7] = y + picture.y;
    picture.instance.update(view, screen);
    renderer.drawLayout(picture.instance);
  }
}
