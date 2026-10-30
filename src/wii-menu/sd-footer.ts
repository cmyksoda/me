import type { Assets } from './assets';
import { Balloon } from './balloon';
import { perMode, type Screen } from './display';
import { center, contains } from './lyt/hit';
import { AnimationPlayer, identity, type LayoutInstance, type PaneNode } from './lyt/layout';
import type { Renderer } from './lyt/renderer';
import type { Sound } from './sound';
import { cover } from './wide';

export type SdFooterTarget = 'menu' | 'help' | 'left' | 'right';

type Side = 'left' | 'right';

// smButtonName's order, which is also the order the GUI resolves overlapping hits in.
const BUTTONS: [SdFooterTarget, string][] = [['menu', 'B_Wiimenu'], ['help', 'B_Help'], ['right', 'B_ArwR'], ['left', 'B_ArwL']];
const BALLOON_DELAY = 16;
const ARROWS = ['N_ArwL', 'N_ArwR'];

function isUnder(pane: PaneNode, names: string[]): boolean {
  for (let p: PaneNode | null = pane; p; p = p.parent) if (names.includes(p.name)) return true;
  return false;
}

/**
 * The SD Card Menu's footer (iplSDButton.cpp, mn_SdcardMenu_b): the light backdrop, the Wii button,
 * the "?" button and the page arrows. SDArrow draws the arrows and the two balloons over everything.
 */
export class SdFooter {
  hovered: SdFooterTarget | null = null;
  private readonly layout: LayoutInstance;
  private readonly clips: Record<string, AnimationPlayer>;
  private readonly balloons: Record<'menu' | 'help', Balloon>;
  private readonly arrowShown = { left: false, right: false };
  private enabled = true;
  private helpPressed = false;

  constructor(assets: Assets, private readonly renderer: Renderer, private readonly sound: Sound) {
    const { sdButton, balloon } = assets.menu;
    this.layout = sdButton.instance('mn_SdcardMenu_b');
    const groups = this.layout.layout.groups;
    const clip = (file: string, group: string, loop = false) => new AnimationPlayer(
      sdButton.animation(`mn_SdcardMenu_b_${file}`)!, this.layout, { panes: groups.get(group), loop },
    );
    // In SDButton::create's bind order, so a later clip wins a pane two of them move.
    this.clips = {
      menuOver: clip('Btn_Wiimenu_rollover', 'G_BL'),
      menuOut: clip('Btn_Wiimenu_rollout', 'G_BL'),
      helpOver: clip('Btn_Help_rollover', 'G_BR'),
      helpPress: clip('Btn_Help_on', 'G_BR'),
      helpOut: clip('Btn_Help_rollout', 'G_BR'),
      idle: clip('Arw_wating_roop', 'G_ArwRoop', true).play(),
      leftPress: clip('ArwL_on', 'G_ArwL_Ac'),
      rightPress: clip('ArwR_on', 'G_ArwR_Ac'),
      leftOver: clip('ArwL_rollover', 'G_ArwL_Focus'),
      rightOver: clip('ArwR_rollover', 'G_ArwR_Focus'),
      leftOut: clip('ArwL_rollout', 'G_ArwL_Focus'),
      rightOut: clip('ArwR_rollout', 'G_ArwR_Focus'),
      leftShow: clip('ArwL_in', 'G_ArwL_End'),
      rightShow: clip('ArwR_in', 'G_ArwR_End'),
      leftHide: clip('ArwL_out', 'G_ArwL_End'),
      rightHide: clip('ArwR_out', 'G_ArwR_End'),
    };
    for (const name of ['menuOver', 'helpOver', 'leftOver', 'rightOver']) this.clips[name].seek(0);
    this.layout.pane('T_page').text = assets.messages['160'];

    // init_textbox(TRUE): these two keep their whole text, with no 20-character cut.
    this.balloons = {
      menu: new Balloon(balloon, sound, BALLOON_DELAY, true),
      help: new Balloon(balloon, sound, BALLOON_DELAY, true),
    };
    this.balloons.menu.setText(renderer, assets.messages['168'], true);
    this.balloons.help.setText(renderer, assets.messages['166'], true);
  }

  /** initArrowAppearance: each arrow shown or hidden at once, by the page. */
  placeArrows(page: number, pages: number): void {
    for (const side of ['left', 'right'] as const) {
      const shown = side === 'left' ? page > 0 : page < pages - 1;
      this.arrowShown[side] = shown;
      // The hide clip's first frame is the shown pose and the show clip's first frame the hidden one.
      this.clips[`${side}${shown ? 'Hide' : 'Show'}`].seek(0);
    }
  }

  /** Arrows that change state play their Appear or Disappear clip; Disappear also lets go of a hover. */
  setArrows(left: boolean, right: boolean): void {
    for (const [side, shown] of [['left', left], ['right', right]] as const) {
      if (this.arrowShown[side] === shown) continue;
      if (!shown && this.hovered === side) this.leave(side);
      this.arrowShown[side] = shown;
      this.clips[`${side}${shown ? 'Hide' : 'Show'}`].playing = false;
      this.clips[`${side}${shown ? 'Show' : 'Hide'}`].play();
    }
  }

  updateArrows(page: number, pages: number): void {
    this.setArrows(page > 0, page < pages - 1);
  }

  /** Which control the pointer is on: the round buttons only while enabled, the arrows only while shown. */
  hit(x: number, y: number): SdFooterTarget | null {
    let found: SdFooterTarget | null = null;
    for (const [target, pane] of BUTTONS) {
      if ((target === 'menu' || target === 'help') && !this.enabled) continue;
      if ((target === 'left' || target === 'right') && !this.arrowShown[target]) continue;
      if (contains(this.layout.pane(pane), x, y)) found = target;
    }
    return found;
  }

  point(target: SdFooterTarget): void {
    this.hovered = target;
    this.clips[`${target}Out`].playing = false;
    this.clips[`${target}Over`].play();
    this.sound.play('WIPL_SE_BT_TARGETTING');
    if (target === 'menu' || target === 'help') this.balloons[target].point();
  }

  leave(target: SdFooterTarget): void {
    if (this.hovered === target) this.hovered = null;
    this.clips[`${target}Over`].playing = false;
    this.clips[`${target}Out`].play();
    if (target === 'menu' || target === 'help') this.balloons[target].leave();
  }

  /** The "?" button's flash; when it ends, every hover is let go (reset_gui). */
  pressHelp(): void {
    this.clips.helpPress.play();
    this.helpPressed = true;
    this.sound.play('WIPL_SE_DECIDE');
  }

  pressArrow(side: Side): void {
    this.clips[`${side}Press`].play();
    this.sound.play('WSD_SELECT');
  }

  /** disableBtn: the round buttons stop answering and their balloons fade; the arrows still work. */
  disable(): void {
    this.enabled = false;
    for (const balloon of Object.values(this.balloons)) balloon.leave();
  }

  /** enableBtn: anything still hovered rolls out, and a resting pointer will be seen afresh. */
  enable(): void {
    this.enabled = true;
    this.releaseAll();
  }

  releaseAll(): void {
    if (this.hovered) this.leave(this.hovered);
    for (const balloon of Object.values(this.balloons)) balloon.leave();
  }

  update(frames: number): void {
    if (this.helpPressed && !this.clips.helpPress.playing) {
      this.helpPressed = false;
      this.releaseAll();
    }
    for (const clip of Object.values(this.clips)) clip.step(frames);
    for (const balloon of Object.values(this.balloons)) balloon.update(frames);
  }

  /** SDButton::draw: the backdrop, the round buttons and the label; the arrows wait for SDArrow. */
  draw(screen: Screen): void {
    cover(this.layout.pane('background'), screen);
    this.layout.update(identity(), screen);
    this.renderer.drawLayout(this.layout, (pane) => !isUnder(pane, ARROWS));
  }

  /** SDArrow::draw: the arrows with the default camera, then the two balloons. */
  drawArrows(screen: Screen): void {
    const camera = this.renderer.camera;
    this.renderer.camera = null;
    this.layout.update(identity(), screen);
    this.renderer.drawLayout(this.layout, (pane) => isUnder(pane, ARROWS));
    this.renderer.camera = camera;
    const margin = perMode(screen, 30, 120);
    for (const [target, pane] of [['menu', 'B_Wiimenu'], ['help', 'B_Help']] as const) {
      const [x, y] = center(this.layout.pane(pane));
      this.balloons[target].draw(this.renderer, screen, x, y + 50, margin);
    }
  }
}
