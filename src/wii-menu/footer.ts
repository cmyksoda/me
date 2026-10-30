import type { Assets } from './assets';
import { Balloon } from './balloon';
import type { Screen } from './display';
import { contains, center } from './lyt/hit';
import { AnimationPlayer, identity, type LayoutInstance, type PaneNode } from './lyt/layout';
import type { Renderer } from './lyt/renderer';
import { parseTPL } from './lyt/tpl';
import type { Sound } from './sound';
import { speakerButton } from './speaker';

export type FooterTarget = 'options' | 'board' | 'left' | 'right' | 'sd' | 'calendar' | 'create' | 'menu' | 'back' | 'trash';

type Mode = 'grid' | 'board' | 'reader';

// Footer buttons with a text balloon, and the bounding pane that is each one's hit area.
const BUTTONS: Partial<Record<FooterTarget, string>> = {
  options: 'B_Set', board: 'B_Bbs', calendar: 'B_Cal', create: 'B_Add', menu: 'B_Ch', back: 'B_CalExit', trash: 'B_Dust',
};
const TARGETS: Record<Mode, FooterTarget[]> = {
  grid: ['sd', 'options', 'board', 'left', 'right'],
  board: ['calendar', 'create', 'menu'],
  reader: ['back', 'trash'],
};

const SPEAKER = { on: 'web_speaker_on.tpl', off: 'web_speaker_off.tpl' };
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
  private readonly balloons: Partial<Record<FooterTarget, Balloon>>;
  private mode: Mode = 'grid';
  private queue: AnimationPlayer[] = [];
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
    // Board transitions: each range moves only the panes it has keys for, as its group binding does.
    const keyed = (name: string, from: number, to: number) => {
      this.clips.set(name, new AnimationPlayer(footer, this.layout, { from, to, keyedOnly: true }));
    };
    keyed('toBoard', 1000, 1040);
    keyed('toGrid', 6000, 6040);
    keyed('lettersOut', 3100, 3113);
    keyed('readerIn', 3600, 3613);
    keyed('backPress', 3000, 3020);
    keyed('readerOut', 3620, 3633);
    keyed('lettersIn', 3426, 3439);
    for (const [name, groupName, inFrom, inTo, outFrom, outTo] of [
      ['Calendar', 'G_Cal', 1900, 1906, 1930, 1938],
      ['Create', 'G_Add', 3900, 3906, 3930, 3938],
      ['Menu', 'G_Ch', 5900, 5906, 5930, 5938],
      ['Back', 'G_CalExit', 2900, 2906, 2930, 2938],
      ['Trash', 'G_Dust', 2900, 2909, 2930, 2938],
    ] as const) {
      range(`point${name}`, group(groupName), inFrom, inTo);
      range(`leave${name}`, group(groupName), outFrom, outTo);
    }
    this.layout.pane('T_CalExit').text = assets.messages['315'];
    this.layout.pane('T_Dust').text = assets.messages['40'];
    this.clips.get('arrowLoop')!.play();
    this.clips.get('mail')!.seek(0);

    const sdClip = (name: string, loop = false) => (
      new AnimationPlayer(cmnBtn.animation(`mn_Sdcard_Btn_${name}`)!, this.sd, { loop })
    );
    this.clips.set('sdLoop', sdClip('On_Roop', true).play());
    this.clips.set('sdPoint', sdClip('BtnL_RollOver'));
    this.clips.set('sdLeave', sdClip('BtnL_RollOut'));
    this.clips.set('sdOut', sdClip('BtnL_Out'));
    this.sd.pane('N_Btn_On').visible = false;

    // The Wii button shows the page's sound instead of the Wii logo, in the logo's own shade.
    const [face] = parseTPL(cmnBtn.files.get('arc/timg/my_TopBtn_a.tpl')!);
    const [art] = parseTPL(cmnBtn.files.get('arc/timg/my_TopBtn_c.tpl')!);
    renderer.addTexture(this.layout, SPEAKER.on, speakerButton(face, art, true));
    renderer.addTexture(this.layout, SPEAKER.off, speakerButton(face, art, false));
    this.setSound(false);

    const labels: [FooterTarget, string][] = [['board', '15'], ['sd', '161'], ['calendar', '17'], ['create', '18'], ['menu', '16']];
    // The Wii button turns the page's sound on and off instead of opening Wii Options.
    this.balloons = { options: new Balloon(balloon, sound, BALLOON_DELAY, true) };
    this.balloons.options!.setText(renderer, 'Toggle Sound On/Off');
    for (const [target, message] of labels) {
      const label = new Balloon(balloon, sound, BALLOON_DELAY, true);
      label.setText(renderer, assets.messages[message]);
      this.balloons[target] = label;
    }
  }

  private play(name: string, backward = false): void {
    this.clips.get(name)!.play(backward);
  }

  /** Plays clips one after another, as the footer's queued scene animations do. */
  private sequence(...names: string[]): void {
    this.queue = names.map((name) => this.clips.get(name)!);
    this.queue[0].play();
  }

  /** Footer transitions lock its buttons until they finish (Button::isActive). */
  get busy(): boolean {
    return this.queue.length > 0 || ['toBoard', 'toGrid'].some((name) => this.clips.get(name)!.playing);
  }

  enterBoard(): void {
    this.releaseAll();
    this.mode = 'board';
    this.play('toBoard');
    this.play('sdOut');
    this.setArrows(false, false);
  }

  openLetter(): void {
    this.releaseAll();
    this.mode = 'reader';
    this.sequence('lettersOut', 'readerIn');
  }

  closeLetter(): void {
    this.releaseAll();
    this.mode = 'board';
    this.sequence('backPress', 'readerOut', 'lettersIn');
  }

  leaveBoard(): void {
    this.releaseAll();
    this.mode = 'grid';
    this.play('toGrid');
    this.play('sdOut', true);
  }

  setSound(on: boolean): void {
    for (const pane of ['BtnL_a1_Set', 'BtnL_a0_Set_00', 'BtnL_a0_Set', 'BtnL_a0_Set_Ac']) {
      this.layout.materials[this.layout.pane(pane).source.picture!.material].textures[0] = on ? SPEAKER.on : SPEAKER.off;
    }
  }

  /** Shows or hides each page arrow at once, as initArrowAppearance does at startup. */
  placeArrows(page: number, pages: number): void {
    this.arrowShown.left = page > 0;
    this.arrowShown.right = page < pages - 1;
    this.clips.get('hideL')!.seek(this.arrowShown.left ? 10160 : 10110);
    this.clips.get('hideR')!.seek(this.arrowShown.right ? 10160 : 10110);
  }

  /** Arrows that change state play their Appear or Disappear clip. */
  setArrows(left: boolean, right: boolean): void {
    for (const [side, shown] of [['L', left], ['R', right]] as const) {
      const key = side === 'L' ? 'left' : 'right';
      if (this.arrowShown[key] === shown) continue;
      this.arrowShown[key] = shown;
      this.clips.get(`${shown ? 'show' : 'hide'}${side}`)!.play();
      if (!shown && this.hovered === key) this.leave(key);
    }
  }

  /** After a scroll lands, the arrows follow the page: none left of the first, none right of the last. */
  updateArrows(page: number, pages: number): void {
    this.setArrows(page > 0, page < pages - 1);
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
    if (this.busy) return null;
    const pane = (target: FooterTarget): PaneNode => {
      if (target === 'sd') return this.sd.pane('N_Btn');
      if (target === 'left' || target === 'right') return this.layout.pane(target === 'left' ? 'B_ArwL' : 'B_ArwR');
      return this.layout.pane(BUTTONS[target]!);
    };
    let found: FooterTarget | null = null;
    for (const target of TARGETS[this.mode]) {
      if ((target === 'left' || target === 'right') && !this.arrowShown[target]) continue;
      if (contains(pane(target), x, y)) found = target;
    }
    return found;
  }

  /** The arrows work in any mode (they page the preview, the grid, or nothing on the board). */
  hitArrow(x: number, y: number): 'left' | 'right' | null {
    for (const side of ['left', 'right'] as const) {
      if (this.arrowShown[side] && contains(this.layout.pane(side === 'left' ? 'B_ArwL' : 'B_ArwR'), x, y)) return side;
    }
    return null;
  }

  private clipName(target: FooterTarget): string {
    if (target === 'left' || target === 'right') return target === 'left' ? 'L' : 'R';
    if (target === 'sd') return 'sd';
    return target[0].toUpperCase() + target.slice(1);
  }

  point(target: FooterTarget): void {
    this.hovered = target;
    this.sound.play('WIPL_SE_BT_TARGETTING');
    this.play(target === 'sd' ? 'sdPoint' : `point${this.clipName(target)}`);
    this.balloons[target]?.point();
  }

  leave(target: FooterTarget): void {
    if (this.hovered === target) this.hovered = null;
    this.play(target === 'sd' ? 'sdLeave' : `leave${this.clipName(target)}`);
    this.balloons[target]?.leave();
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
    for (const balloon of Object.values(this.balloons)) balloon!.hideNow();
  }

  update(frames: number): void {
    for (const clip of this.clips.values()) clip.step(frames);
    if (this.queue.length && !this.queue[0].playing) {
      this.queue.shift();
      this.queue[0]?.play();
    }
    for (const balloon of Object.values(this.balloons)) balloon!.update(frames);
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
    // The Arrow scene always draws with the default camera, zoom or not.
    const camera = this.renderer.camera;
    this.renderer.camera = null;
    this.layout.update(identity(), screen);
    this.renderer.drawLayout(this.layout, (pane) => isUnder(pane, ['N_ArwL', 'N_ArwR']));
    this.renderer.camera = camera;
    const margin = screen.wide ? 120 : 30;
    for (const [target, pane] of Object.entries(BUTTONS) as [FooterTarget, string][]) {
      const [x, y] = center(this.layout.pane(pane));
      this.balloons[target]?.draw(this.renderer, screen, x, y + 50, margin);
    }
    const [sx, sy] = center(this.sd.pane('N_Btn'));
    this.balloons.sd!.draw(this.renderer, screen, sx, sy + 50, screen.wide ? 200 : 110);
  }

  get mail(): number {
    return this.mailCount;
  }
}
