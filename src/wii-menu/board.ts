import type { Assets } from './assets';
import type { Screen } from './display';
import { measureText, type FontMetrics } from './lyt/font';
import { center, contains } from './lyt/hit';
import { AnimationPlayer, identity, type LayoutInstance, type PaneNode } from './lyt/layout';
import type { Renderer } from './lyt/renderer';
import type { Letter } from './letters';
import type { Sound } from './sound';
import { translation } from './grid';

const WEEKDAYS = [116, 110, 111, 112, 113, 114, 115];
const FLY_FRAMES = 17;
const SECTION = 168;
const LINE = 42;
const TEXT_WIDTH = 413;
const ARROW_STEP = 300;
const ARROW_FRAMES = 20;
const DECIDE_AFTER = 5;
const FONT = 'RevoIpl_UtrilloProGrecoStd_M_32_I4';

interface Card {
  letter: Letter;
  instance: LayoutInstance;
  clips: Record<'paste' | 'idle' | 'focusIn' | 'focusOut' | 'select' | 'exit', AnimationPlayer>;
  hovered: boolean;
}

type State = 'hidden' | 'normal' | 'opening' | 'reading' | 'closing';

/** Breaks text so every line fits the reader's 413 units; the original text boxes never wrap. */
function wrap(font: FontMetrics, content: Parameters<typeof measureText>[1], text: string): string {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(' ')) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && measureText(font, content, candidate) > TEXT_WIDTH) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    lines.push(line);
  }
  return lines.join('\n');
}

/**
 * The Wii Message Board (iplBoard.cpp, iplBoardObject.cpp, iplFocusObject.cpp): the backdrop with
 * the date, letters pinned to it, and the reader that opens over a dimmed board.
 */
export class Board {
  state: State = 'hidden';
  onClosed: (() => void) | null = null;
  onOpened: (() => void) | null = null;
  private readonly backdrop: LayoutInstance;
  private readonly cards: Card[];
  private readonly mask: LayoutInstance;
  private readonly maskIn: AnimationPlayer;
  private readonly maskOut: AnimationPlayer;
  private masked = false;
  private readonly reader: LayoutInstance;
  private readonly readerClips: Record<string, AnimationPlayer>;
  private readonly bScroll: LayoutInstance;
  private open: Card | null = null;
  private fly = 0;
  private scroll = 0;
  private scrollMax = 0;
  private sections = 1;
  private target: { from: number; to: number; frame: number } | null = null;
  private bOrigin: [number, number] | null = null;
  private bSpeed = 0;
  private scrolled = 0;
  private arrowsShown = { up: false, down: false };
  private hoveredArrow: 'up' | 'down' | null = null;

  constructor(private readonly assets: Assets, private readonly renderer: Renderer, private readonly sound: Sound,
    letterList: Letter[]) {
    const { board, cursor } = assets.menu;
    this.backdrop = board.instance('my_IplTop_c');
    new AnimationPlayer(board.animation('my_IplTop_c')!, this.backdrop, { from: 0, to: 0 }).seek(0);
    this.setDate(new Date());

    this.cards = letterList.map((letter) => {
      const instance = board.instance('LetterS_b');
      const clip = (name: string, loop = false) => new AnimationPlayer(board.animation(`LetterS_b_${name}`)!, instance, { loop });
      for (const hidden of ['Nigaoe', 'N_Pic', 'PinSD0', 'PinSD1']) instance.pane(hidden).visible = false;
      // The card shows six characters of the title, then "..." if there's more.
      instance.pane('T_Letter').text = letter.title.length > 6 ? `${letter.title.slice(0, 6)}...` : letter.title;
      const card: Card = {
        letter,
        instance,
        clips: {
          paste: clip('PasteLetter'),
          idle: clip('DefAnim', true),
          focusIn: clip('FocusIn'),
          focusOut: clip('FocusOut'),
          select: clip('SelectLetter'),
          exit: clip('ExitLetter'),
        },
        hovered: false,
      };
      card.clips.paste.play();
      card.clips.idle.play();
      return card;
    });

    this.mask = board.instance('my_BbsMask_a');
    this.maskIn = new AnimationPlayer(board.animation('my_BbsMask_a_MaskIn')!, this.mask);
    this.maskOut = new AnimationPlayer(board.animation('my_BbsMask_a_MaskOut')!, this.mask);

    this.reader = board.instance('my_LetterL');
    for (const hidden of ['SendPic', 'Nigaoe', 'B_Nigaoe', 'T_Nigaoe', 'T_TouchLetter', 'PicMask', 'N_Pic', 'B_Pic', 'ReplyMask']) {
      this.reader.pane(hidden).visible = false;
    }
    const groups = this.reader.layout.groups;
    const readerClip = (name: string, group: string, loop = false) => new AnimationPlayer(
      board.animation(`my_LetterL_${name}`)!, this.reader, { panes: groups.get(group) ?? [], loop },
    );
    // The reader's arrows are turned 90°: "R" sits at the top and scrolls up, "L" at the bottom.
    this.readerClips = {
      upLoop: readerClip('Loop', 'G_ArwRoop', true),
      upShow: readerClip('Appear', 'G_ArwR_End'),
      upHide: readerClip('Lost', 'G_ArwR_End'),
      downShow: readerClip('Appear', 'G_ArwL_End'),
      downHide: readerClip('Lost', 'G_ArwL_End'),
      upOn: readerClip('FocusOn', 'G_ArwR_Focus'),
      upOff: readerClip('FocusOff', 'G_ArwR_Focus'),
      downOn: readerClip('FocusOn', 'G_ArwL_Focus'),
      downOff: readerClip('FocusOff', 'G_ArwL_Focus'),
      upPress: readerClip('Select', 'G_ArwR_Ac'),
      downPress: readerClip('Select', 'G_ArwL_Ac'),
    };
    this.readerClips.upHide.seek(10);
    this.readerClips.downHide.seek(10);
    this.bScroll = cursor.instance('my_BScroll_a');
  }

  /** "Fri 10/30": yesterday, today and tomorrow sit side by side for the midnight slide. */
  private setDate(today: Date): void {
    ['a', 'b', 'c'].forEach((suffix, i) => {
      const day = new Date(today);
      day.setDate(today.getDate() + i - 1);
      const weekday = this.assets.messages[String(WEEKDAYS[day.getDay()])];
      this.backdrop.pane(`T_Day_${suffix}`).text = `${weekday} ${day.getMonth() + 1}/${day.getDate()}`;
    });
  }

  get letterCount(): number {
    return this.cards.length;
  }

  show(): void {
    this.state = 'normal';
  }

  hide(): void {
    this.state = 'hidden';
    for (const card of this.cards) this.leaveCard(card);
  }

  private pointCard(card: Card): void {
    if (card.hovered) return;
    card.hovered = true;
    card.clips.focusOut.playing = false;
    card.clips.focusIn.play();
    this.sound.play('WIPL_SE_BOARD_FOCUS');
    // A hovered card is drawn last, on top of the others.
    this.cards.splice(this.cards.indexOf(card), 1);
    this.cards.push(card);
  }

  private leaveCard(card: Card): void {
    if (!card.hovered) return;
    card.hovered = false;
    card.clips.focusIn.playing = false;
    card.clips.focusOut.play();
  }

  private openLetter(card: Card): void {
    this.open = card;
    this.state = 'opening';
    this.fly = 0;
    this.leaveCard(card);
    card.clips.select.play();
    this.maskIn.play();
    this.masked = true;
    this.sound.play('WIPL_SE_BOARD_SELECT');
    this.onOpened?.();

    const body = this.reader.pane('T_Letter');
    const content = body.source.text!;
    const font = this.renderer.fonts.get(FONT)!.metrics;
    body.text = wrap(font, content, card.letter.body);
    this.reader.pane('T_Header').text = card.letter.title;
    const lines = body.text.split('\n').length;
    this.sections = Math.max(1, Math.ceil((lines * LINE) / SECTION));
    this.scrollMax = Math.max(0, 160 + this.sections * SECTION + 144 + 64 - 456);
    this.scroll = 0;
    this.target = null;
    this.readerClips.upLoop.play();
  }

  /** Footer's Back: the letter flies back to its card while the dimmer lifts. */
  closeLetter(): void {
    if (this.state !== 'reading' || !this.open) return;
    this.state = 'closing';
    this.open.clips.exit.play();
    this.maskOut.play();
    this.setArrow('up', false);
    this.setArrow('down', false);
    this.sound.play('WIPL_SE_BOARD_UNSELECT');
  }

  private setArrow(arrow: 'up' | 'down', shown: boolean): void {
    if (this.arrowsShown[arrow] === shown) return;
    this.arrowsShown[arrow] = shown;
    this.readerClips[`${arrow}${shown ? 'Show' : 'Hide'}`].play();
  }

  /** Scrolls by a button press: ±300 over 20 updates, eased from wherever the letter is. */
  private scrollBy(amount: number): void {
    const to = Math.min(this.scrollMax, Math.max(0, this.scroll + amount));
    this.target = { from: this.scroll, to, frame: 0 };
  }

  wheel(delta: number): void {
    if (this.state !== 'reading') return;
    this.target = null;
    this.scroll = Math.min(this.scrollMax, Math.max(0, this.scroll + delta));
  }

  get reading(): boolean {
    return this.state === 'reading';
  }

  /** While B is held the hand gives way to the scroll marker. */
  get bScrolling(): boolean {
    return this.bOrigin !== null;
  }

  update(frames: number, pointer: { x: number; y: number; a: boolean; b: boolean; aPressed: boolean; sincePress: number | null },
    active: boolean, screen: Screen): void {
    for (const card of this.cards) for (const clip of Object.values(card.clips)) clip.step(frames);
    this.maskIn.step(frames);
    this.maskOut.step(frames);
    if (this.masked && this.state === 'normal' && !this.maskOut.playing) this.masked = false;
    for (const clip of Object.values(this.readerClips)) clip.step(frames);

    if (this.state === 'opening' || this.state === 'closing') {
      this.fly = Math.min(FLY_FRAMES, this.fly + frames);
      if (this.fly >= FLY_FRAMES) {
        if (this.state === 'opening') {
          this.state = 'reading';
          this.setArrow('down', this.scrollMax > 0);
        } else {
          this.state = 'normal';
          this.open = null;
          this.onClosed?.();
        }
      }
    }

    if (this.state === 'reading') this.updateReader(frames, pointer, active, screen);
    else if (this.state === 'normal' && active) this.updateCards(pointer, frames);
  }

  private updateCards(pointer: { x: number; y: number; b: boolean; sincePress: number | null }, frames: number): void {
    let hit: Card | null = null;
    for (const card of this.cards) if (contains(card.instance.pane('B_Letter'), pointer.x, pointer.y)) hit = card;
    for (const card of this.cards) if (card !== hit) this.leaveCard(card);
    if (hit) this.pointCard(hit);
    const since = pointer.sincePress;
    if (hit && since !== null && since >= DECIDE_AFTER && since - frames < DECIDE_AFTER && !pointer.b) this.openLetter(hit);
  }

  private updateReader(frames: number, pointer: { x: number; y: number; b: boolean; aPressed: boolean },
    active: boolean, screen: Screen): void {
    // B is a rate control: the farther from where it went down, the faster the letter keeps moving.
    if (pointer.b && active) {
      this.bOrigin ??= [pointer.x, pointer.y];
      const delta = (this.bOrigin[1] - pointer.y) / (screen.wide ? 289 : 251);
      this.bSpeed = Math.abs(delta) < 0.01 ? 0 : Math.sign(delta) * 10 * delta * delta;
      this.target = null;
      const before = this.scroll;
      this.scroll = Math.min(this.scrollMax, Math.max(0, this.scroll + this.bSpeed * frames));
      this.scrolled += Math.abs(this.scroll - before);
      if (this.scrolled >= 128) {
        this.scrolled -= 128;
        this.sound.play('WIPL_SE_B_SCROLL');
      }
    } else {
      this.bOrigin = null;
      this.bSpeed = 0;
    }

    if (this.target) {
      this.target.frame = Math.min(ARROW_FRAMES, this.target.frame + frames);
      const t = this.target.frame / ARROW_FRAMES;
      this.scroll = this.target.from + (this.target.to - this.target.from) * t * t * (3 - 2 * t);
      if (this.target.frame >= ARROW_FRAMES) this.target = null;
    }
    this.setArrow('up', this.scroll > 0);
    this.setArrow('down', this.scroll < this.scrollMax);

    if (!active || this.bOrigin) return;
    const arrows = { up: this.reader.pane('B_ArwR'), down: this.reader.pane('B_ArwL') };
    let hovered: 'up' | 'down' | null = null;
    for (const arrow of ['up', 'down'] as const) {
      if (this.arrowsShown[arrow] && contains(arrows[arrow], pointer.x, pointer.y)) hovered = arrow;
    }
    if (hovered !== this.hoveredArrow) {
      if (this.hoveredArrow) this.readerClips[`${this.hoveredArrow}Off`].play();
      if (hovered) {
        this.readerClips[`${hovered}On`].play();
        this.sound.play('WIPL_SE_BT_TARGETTING');
      }
      this.hoveredArrow = hovered;
    }
    if (pointer.aPressed && hovered && !this.target) {
      this.readerClips[`${hovered}Press`].play();
      this.scrollBy(hovered === 'up' ? -ARROW_STEP : ARROW_STEP);
    }
  }

  draw(screen: Screen): void {
    const view = identity();
    this.backdrop.update(view, screen);
    this.renderer.drawLayout(this.backdrop);
    for (const card of this.cards) {
      const [x, y] = card.letter.position;
      // Cards spread out on a wide screen but aren't stretched.
      card.instance.update(translation(x * (screen.width / 608), y), screen);
      this.renderer.drawLayout(card.instance);
    }
    if (this.masked) {
      (this.maskOut.playing || this.state === 'normal' ? this.maskOut : this.maskIn).apply();
      this.mask.update(view, screen);
      this.renderer.drawLayout(this.mask);
    }
    if (this.open && this.state !== 'hidden' && this.state !== 'normal') this.drawReader(screen);
  }

  private drawReader(screen: Screen): void {
    // The reader flies in a straight line from its card to the middle of the screen.
    const [cardX, cardY] = this.open!.letter.position;
    const t = this.state === 'closing' ? 1 - this.fly / FLY_FRAMES : this.fly / FLY_FRAMES;
    const view = translation(cardX * (1 - t), cardY * (1 - t));
    const memo = this.reader.pane('N_Memo');
    memo.translate[1] = this.scroll;
    const [header, body, footer, text, buttons] = ['N_Header', 'N_Body', 'N_Footer', 'T_Letter', 'N_TopBtn']
      .map((name) => this.reader.pane(name));
    const draw = (part: PaneNode) => this.renderer.drawLayout(this.reader, (pane) => this.under(pane, [part]));
    this.reader.update(view, screen);
    draw(header);
    // focus_object::draw repeats the ruled middle once per 168 units of text, then adds the bottom.
    for (let k = 0; k < this.sections; k++) {
      body.translate[1] = -SECTION * k;
      this.reader.update(view, screen);
      const y = center(body)[1];
      if (y > -700 && y < 700) draw(body);
    }
    footer.translate[1] = -SECTION * (this.sections - 1);
    body.translate[1] = 0;
    this.reader.update(view, screen);
    draw(footer);
    draw(text);
    draw(buttons);
  }

  private under(pane: PaneNode, ancestors: PaneNode[]): boolean {
    for (let p: PaneNode | null = pane; p; p = p.parent) if (ancestors.includes(p)) return true;
    return false;
  }

  drawCursor(screen: Screen, x: number, y: number): void {
    if (!this.bOrigin) return;
    const [ox, oy] = this.bOrigin;
    this.bScroll.pane('BArwBase').visible = this.bSpeed === 0;
    const arrow = this.bScroll.pane('N_BArw');
    arrow.visible = this.bSpeed !== 0;
    arrow.scale[1] = this.bSpeed < 0 ? -1 : 1;
    this.bScroll.pane('W_BArw').size[1] = Math.min(128, Math.max(32, Math.abs(y - oy)));
    this.bScroll.update(translation(ox, oy), screen);
    this.renderer.drawLayout(this.bScroll);
    void x;
  }
}
