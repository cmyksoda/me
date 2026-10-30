import type { Assets } from './assets';
import { Balloon } from './balloon';
import type { Screen } from './display';
import { contains, center } from './lyt/hit';
import { AnimationPlayer, identity, type LayoutInstance, type PaneNode } from './lyt/layout';
import type { Renderer } from './lyt/renderer';
import type { Sound } from './sound';

export type FooterTarget = 'options' | 'board' | 'left' | 'right' | 'sd';

const BALLOON_DELAY = 16;
const NEW_MAIL_EVERY = 3000;

function isUnder(pane: PaneNode, names: string[]): boolean {
  for (let p: PaneNode | null = pane; p; p = p.parent) if (names.includes(p.name)) return true;
  return false;
}

/**
 * The footer (Button and Arrow scenes, iplButton.cpp/iplArrow.cpp): the Wii and Message Board pods,
 * the page arrows, the SD card button, their balloons and the mail counter.
 */
export class Footer {
  hovered: FooterTarget | null = null;
  private readonly layout: LayoutInstance;
  private readonly sd: LayoutInstance;
  private readonly clips = new Map<string, AnimationPlayer>();
  private readonly balloons: Record<'options' | 'board' | 'sd', Balloon>;
  private readonly arrowShown = { left: false, right: false };
  private mailCount = 0;
  private newMailSince: number | null = null;

  constructor(private readonly assets: Assets, private readonly renderer: Renderer, private readonly sound: Sound) {
    const { cmnBtn, balloon } = assets.menu;
    this.layout = cmnBtn.instance('my_IplTop_e');
    this.sd = cmnBtn.instance('mn_Sdcard_Btn');
    const footer = cmnBtn.animation('my_IplTop_e')!;
    const range = (name: string, panes: string[], from: number, to: number, loop = false) => {
      this.clips.set(name, new AnimationPlayer(footer, this.layout, { panes, from, to, loop }));
    };
    const group = (name: string) => this.layout.layout.groups.get(name) ?? [];
    range('arrowLoop', group('G_ArwRoop'), 10000, 10055, true);
    for (const side of ['L', 'R']) {
      const end = group(`G_Arw${side}_End`);
      range(`hide${side}`, end, 10100, 10110);
      range(`show${side}`, end, 10150, 10160);
      range(`point${side}`, group(`G_Arw${side}_Focus`), 10600, 10615);
      range(`leave${side}`, group(`G_Arw${side}_Focus`), 10800, 10815);
      range(`press${side}`, group(`G_Arw${side}_Ac`), 10700, 10730);
    }
    range('pointOptions', group('G_Set'), 6900, 6906);
    range('leaveOptions', group('G_Set'), 6930, 6938);
    // 4.3 never plays this press flash, but it is the resource's own, made for this button.
    range('pressOptions', ['N_BtnL_a0_Set', 'BtnL_a0_Set_Ac'], 7000, 7020);
    range('pointBoard', group('G_Bbs'), 900, 906);
    range('leaveBoard', group('G_Bbs'), 930, 938);
    range('pressBoard', group('G_Bbs'), 1000, 1020);
    range('mail', group('G_BbsSignal'), 1, 400, true);
    range('newMail', group('G_BbsSignal_new'), 1, 160);
    this.clips.get('arrowLoop')!.play();
    this.clips.get('mail')!.seek(0);

    const sdClip = (name: string, loop = false) => (
      new AnimationPlayer(cmnBtn.animation(`mn_Sdcard_Btn_${name}`)!, this.sd, { loop })
    );
    this.clips.set('sdLoop', sdClip('On_Roop', true).play());
    this.clips.set('sdPoint', sdClip('BtnL_RollOver'));
    this.clips.set('sdLeave', sdClip('BtnL_RollOut'));
    this.sd.pane('N_Btn_On').visible = false;

    this.balloons = {
      options: new Balloon(balloon, sound, BALLOON_DELAY, true),
      board: new Balloon(balloon, sound, BALLOON_DELAY, true),
      sd: new Balloon(balloon, sound, BALLOON_DELAY, true),
    };
    this.balloons.board.setText(renderer, assets.messages['15']);
    this.balloons.sd.setText(renderer, assets.messages['161']);
  }

  setSoundLabel(on: boolean): void {
    this.balloons.options.setText(this.renderer, on ? 'Sound: On' : 'Sound: Off');
  }

  /** Shows or hides each page arrow at once, as initArrowAppearance does at startup. */
  placeArrows(page: number, pages: number): void {
    this.arrowShown.left = page > 0;
    this.arrowShown.right = page < pages - 1;
    this.clips.get('hideL')!.seek(this.arrowShown.left ? 10160 : 10110);
    this.clips.get('hideR')!.seek(this.arrowShown.right ? 10160 : 10110);
  }

  /** After a scroll lands, arrows that change state play their Appear or Disappear clip. */
  updateArrows(page: number, pages: number): void {
    for (const [side, shown] of [['L', page > 0], ['R', page < pages - 1]] as const) {
      const key = side === 'L' ? 'left' : 'right';
      if (this.arrowShown[key] === shown) continue;
      this.arrowShown[key] = shown;
      this.clips.get(`${shown ? 'show' : 'hide'}${side}`)!.play();
      if (!shown && this.hovered === key) this.leave(key);
    }
  }

  /** The Message Board count: letters dated today. New letters ring the button until it is opened. */
  setMail(count: number, fresh: boolean): void {
    this.mailCount = count;
    this.layout.pane('T_BbsMark1').text = String(count);
    const mail = this.clips.get('mail')!;
    if (count > 0) mail.play();
    else mail.seek(0);
    this.newMailSince = fresh ? performance.now() - NEW_MAIL_EVERY : null;
  }

  stopNewMail(): void {
    this.newMailSince = null;
  }

  /** Which footer control the pointer is over, in the order the GUI manager resolves them. */
  hit(x: number, y: number): FooterTarget | null {
    const panes: [FooterTarget, PaneNode][] = [
      ['sd', this.sd.pane('N_Btn')],
      ['options', this.layout.pane('B_Set')],
      ['board', this.layout.pane('B_Bbs')],
      ['left', this.layout.pane('B_ArwL')],
      ['right', this.layout.pane('B_ArwR')],
    ];
    let found: FooterTarget | null = null;
    for (const [target, pane] of panes) {
      if ((target === 'left' || target === 'right') && !this.arrowShown[target]) continue;
      if (contains(pane, x, y)) found = target;
    }
    return found;
  }

  point(target: FooterTarget): void {
    this.hovered = target;
    this.sound.play('WIPL_SE_BT_TARGETTING');
    if (target === 'left' || target === 'right') this.clips.get(`point${target === 'left' ? 'L' : 'R'}`)!.play();
    else if (target === 'sd') this.clips.get('sdPoint')!.play();
    else this.clips.get(target === 'options' ? 'pointOptions' : 'pointBoard')!.play();
    if (target !== 'left' && target !== 'right') this.balloons[target].point();
  }

  leave(target: FooterTarget): void {
    if (this.hovered === target) this.hovered = null;
    if (target === 'left' || target === 'right') this.clips.get(`leave${target === 'left' ? 'L' : 'R'}`)!.play();
    else if (target === 'sd') this.clips.get('sdLeave')!.play();
    else this.clips.get(target === 'options' ? 'leaveOptions' : 'leaveBoard')!.play();
    if (target !== 'left' && target !== 'right') this.balloons[target].leave();
  }

  press(target: FooterTarget): void {
    if (target === 'left' || target === 'right') {
      this.clips.get(`press${target === 'left' ? 'L' : 'R'}`)!.play();
      this.sound.play('WSD_SELECT');
    } else if (target === 'options') {
      this.clips.get('pressOptions')!.play();
      this.sound.play('WIPL_SE_DECIDE');
    } else if (target === 'board') {
      this.clips.get('pressBoard')!.play();
      this.sound.play('WIPL_SE_DECIDE');
    }
  }

  /** Lets go of every hover at once, as the menu does when it leaves its normal state. */
  releaseAll(): void {
    if (this.hovered) this.leave(this.hovered);
    for (const balloon of Object.values(this.balloons)) balloon.hideNow();
  }

  update(frames: number): void {
    for (const clip of this.clips.values()) clip.step(frames);
    for (const balloon of Object.values(this.balloons)) balloon.update(frames);
    if (this.newMailSince !== null && performance.now() - this.newMailSince >= NEW_MAIL_EVERY) {
      this.newMailSince = performance.now();
      this.clips.get('newMail')!.play();
      this.sound.play('WIPL_SE_NEW_ARRIVAL');
    }
  }

  /** Button scene: the SD icon, then the pods; the arrows wait for the Arrow scene. */
  drawPods(screen: Screen): void {
    const view = identity();
    view[3] = screen.wide ? -245 : -152;
    view[7] = -172;
    this.sd.update(view, screen);
    this.renderer.drawLayout(this.sd);
    this.layout.update(identity(), screen);
    this.renderer.drawLayout(this.layout, (pane) => !isUnder(pane, ['N_ArwL', 'N_ArwR']));
  }

  /** Arrow scene: the page arrows over the grid, then the footer balloons. */
  drawArrows(screen: Screen): void {
    this.renderer.drawLayout(this.layout, (pane) => isUnder(pane, ['N_ArwL', 'N_ArwR']));
    const margin = screen.wide ? 120 : 30;
    for (const [target, pane] of [['options', 'B_Set'], ['board', 'B_Bbs']] as const) {
      const [x, y] = center(this.layout.pane(pane));
      this.balloons[target].draw(this.renderer, screen, x, y + 50, margin);
    }
    const [sx, sy] = center(this.sd.pane('N_Btn'));
    this.balloons.sd.draw(this.renderer, screen, sx, sy + 50, screen.wide ? 200 : 110);
  }

  get mail(): number {
    return this.mailCount;
  }
}
