import type { Assets } from './assets';
import { SCREEN_HEIGHT, type Screen } from './display';
import { layoutText, measureText, type FontMetrics } from './lyt/font';
import { center, contains, toLocal } from './lyt/hit';
import { AnimationPlayer, identity, type LayoutInstance, type PaneNode } from './lyt/layout';
import type { Renderer } from './lyt/renderer';
import type { Letter } from './letters';
import type { Sound } from './sound';
import type { RGBA } from './lyt/binary';
import { translation } from './grid';

const WEEKDAYS = [116, 110, 111, 112, 113, 114, 115];
const FLY_FRAMES = 17;
// stt_wait_btn: the letter waits out Back's press flash before it flies home.
const BACK_FLASH_FRAMES = 20;
const SECTION = 168;
const LINE = 42;
const TEXT_WIDTH = 413;
const ARROW_STEP = 300;
const ARROW_FRAMES = 20;
const DECIDE_AFTER = 5;
const PLACES_KEY = 'wii-forwarders.letter-places';
// RBRGetPosRect: where a letter can be pinned, in the board's 4:3 units.
const BOUNDS = { left: -230, right: 230, top: 180, bottom: -80 };
const FONT = 'RevoIpl_UtrilloProGrecoStd_M_32_I4';
// UrlProcessor::parse: links are Wii blue, orange and raised while pointed at, yellow when chosen.
const LINK: RGBA = [0x34, 0xbe, 0xed, 255];
const LINK_POINTED: RGBA = [0xf0, 0x6e, 0x28, 255];
const LINK_CHOSEN: RGBA = [0xff, 0xe6, 0x64, 255];

interface Link {
  from: number;
  to: number;
  href: string;
  box: [number, number, number, number];
}

/** A letter wrapped for the reader, with its links' hit boxes. */
interface Reading {
  text: string;
  links: Link[];
  sections: number;
  scrollMax: number;
}

interface Card {
  letter: Letter;
  /** Where it's pinned, which the visitor can change by picking it up. */
  position: [number, number];
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

function clampPlace(x: number, y: number): [number, number] {
  return [Math.min(BOUNDS.right, Math.max(BOUNDS.left, x)), Math.min(BOUNDS.top, Math.max(BOUNDS.bottom, y))];
}

/** The pointer in the board's 4:3 units, as stt_pinch scales the remote's x on a wide screen. */
function toBoard(pointer: { x: number; y: number }, screen: Screen): [number, number] {
  return [pointer.x * (608 / screen.width), pointer.y];
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
  private readonly readings = new Map<Letter, Reading>();
  private readonly bScroll: LayoutInstance;
  private open: Card | null = null;
  private fly = 0;
  private leaveIn = 0;
  private scroll = 0;
  private wheelTo: number | null = null;
  private scrollMax = 0;
  private sections = 1;
  private target: { from: number; to: number; frame: number } | null = null;
  private bOrigin: [number, number] | null = null;
  private bSpeed = 0;
  /** How far the pointer is from where B went down, in the remote's −1…1 units. */
  private bDelta = 0;
  private scrolled = 0;
  private arrowsShown = { up: false, down: false };
  private links: Link[] = [];
  private pointedLink: Link | null = null;
  private chosenLink: Link | null = null;
  private hoveredArrow: 'up' | 'down' | null = null;
  private pinched: { card: Card; from: [number, number]; offset: [number, number] } | null = null;

  constructor(private readonly assets: Assets, private readonly renderer: Renderer, private readonly sound: Sound,
    letterList: Letter[]) {
    const { board, cursor } = assets.menu;
    let places: Record<string, [number, number]> = {};
    try {
      places = JSON.parse(localStorage.getItem(PLACES_KEY) ?? '{}') ?? {};
    } catch {}
    this.backdrop = board.instance('my_IplTop_c');
    new AnimationPlayer(board.animation('my_IplTop_c')!, this.backdrop, { from: 0, to: 0 }).seek(0);
    this.setDate(new Date());

    this.cards = letterList.map((letter) => {
      const instance = board.instance('LetterS_b');
      const clip = (name: string, loop = false) => new AnimationPlayer(board.animation(`LetterS_b_${name}`)!, instance, { loop });
      for (const hidden of ['Nigaoe', 'N_Pic', 'PinSD0', 'PinSD1']) instance.pane(hidden).visible = false;
      // The card shows six characters of the title, then "..." if there's more.
      instance.pane('T_Letter').text = letter.title.length > 6 ? `${letter.title.slice(0, 6)}...` : letter.title;
      const saved = places[letter.title];
      const card: Card = {
        letter,
        position: Array.isArray(saved) && saved.every(Number.isFinite) ? clampPlace(saved[0], saved[1]) : [...letter.position],
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
      // The paper grows out of its card and fades in, and shrinks back into it on the way out.
      open: new AnimationPlayer(board.animation('my_LetterL_SelectLetter')!, this.reader, { keyedOnly: true }),
      exit: new AnimationPlayer(board.animation('my_LetterL_ExitLetter')!, this.reader, { keyedOnly: true }),
    };
    this.readerClips.upHide.seek(10);
    this.readerClips.downHide.seek(10);
    this.bScroll = cursor.instance('my_BScroll_a');
    for (const card of this.cards) this.readings.set(card.letter, this.read(card.letter));
  }

  /** Wraps a letter and finds its links ahead of time, since the license letter takes a while. */
  private read(letter: Letter): Reading {
    const body = this.reader.pane('T_Letter');
    const content = body.source.text!;
    const font = this.renderer.fonts.get(FONT)!.metrics;
    const text = wrap(font, content, letter.body);
    // Links found in the text get hit boxes from where their glyphs land.
    const quads = layoutText(font, content, text, body.source.origin, body.size);
    // Links are written without https:// so they fit the paper's width.
    const links = [...text.matchAll(/(?:https?:\/\/)?github\.com\/\S+/g)].map((match) => {
      const from = match.index;
      const to = from + match[0].length;
      const glyphs = quads.filter((q) => q.index >= from && q.index < to);
      const box: Link['box'] = [
        Math.min(...glyphs.map((q) => q.left)), Math.min(...glyphs.map((q) => q.top)),
        Math.max(...glyphs.map((q) => q.right)), Math.max(...glyphs.map((q) => q.bottom)),
      ];
      return { from, to, href: match[0].startsWith('http') ? match[0] : `https://${match[0]}`, box };
    });
    const sections = Math.max(1, Math.ceil((text.split('\n').length * LINE) / SECTION));
    return { text, links, sections, scrollMax: Math.max(0, 160 + sections * SECTION + 144 + 64 - 456) };
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
    this.readerClips.open.play();
    this.maskIn.play();
    this.masked = true;
    this.sound.play('WIPL_SE_BOARD_SELECT');
    this.onOpened?.();

    const reading = this.readings.get(card.letter)!;
    this.reader.pane('T_Letter').text = reading.text;
    this.reader.pane('T_Header').text = card.letter.title;
    this.links = reading.links;
    this.pointedLink = null;
    this.chosenLink = null;
    this.colorLinks();
    this.sections = reading.sections;
    this.scrollMax = reading.scrollMax;
    this.scroll = 0;
    this.wheelTo = null;
    this.target = null;
    this.readerClips.upLoop.play();
  }

  private colorLinks(): void {
    this.reader.pane('T_Letter').textRuns = this.links.map((link) => ({
      from: link.from,
      to: link.to,
      color: link === this.chosenLink ? LINK_CHOSEN : link === this.pointedLink ? LINK_POINTED : LINK,
      lift: link === this.pointedLink ? 2 : 0,
    }));
  }

  private linkUnder(x: number, y: number): Link | null {
    const local = toLocal(this.reader.pane('T_Letter'), x, y);
    if (!local) return null;
    const [lx, ly] = local;
    return this.links.find(({ box }) => lx >= box[0] && lx <= box[2] && ly >= box[1] && ly <= box[3]) ?? null;
  }

  /** The link a click lands on, opened inside the click itself so browsers allow the new tab. */
  linkAt(x: number, y: number): string | null {
    if (this.state !== 'reading' || this.bOrigin) return null;
    const link = this.linkUnder(x, y);
    if (!link) return null;
    this.chosenLink = link;
    this.colorLinks();
    this.sound.play('WIPL_SE_DECIDE');
    return link.href;
  }

  /** While B holds a card, the hand is the grabbing hand. */
  get pinching(): boolean {
    return this.pinched !== null;
  }

  /** Board::pinch: B on a card picks it up (A+B on the console). */
  private pinch(card: Card, pointer: { x: number; y: number }, screen: Screen): void {
    this.pinched = { card, from: toBoard(pointer, screen), offset: [0, 0] };
    this.sound.play('WIPL_SE_BOARD_HOLD', card.position[0] / 304);
  }

  /**
   * stt_pinch: the card follows the hand, unclamped, while B is held. Letting go pins it inside the
   * board's bounds; pointing off the TV first drops it back where it was, as an invalid pointer does.
   */
  private updatePinch(pointer: { x: number; y: number; b: boolean }, frames: number, screen: Screen, active: boolean): void {
    const pinched = this.pinched!;
    const { card } = pinched;
    if (pointer.b && active) {
      const [x, y] = toBoard(pointer, screen);
      const offset: [number, number] = [x - pinched.from[0], y - pinched.from[1]];
      const speed = Math.hypot(offset[0] - pinched.offset[0], offset[1] - pinched.offset[1]) / Math.max(frames, 1e-3);
      pinched.offset = offset;
      this.sound.hold('WIPL_SE_BOARD_DRAG', { pan: (card.position[0] + offset[0]) / 304, volume: Math.min(1, (2 * speed) / 304) });
      return;
    }
    if (active) {
      card.position = clampPlace(card.position[0] + pinched.offset[0], card.position[1] + pinched.offset[1]);
      this.savePlaces();
    }
    this.pinched = null;
    this.sound.play('WIPL_SE_BOARD_RELEASE', card.position[0] / 304);
  }

  private savePlaces(): void {
    try {
      localStorage.setItem(PLACES_KEY, JSON.stringify(Object.fromEntries(this.cards.map((c) => [c.letter.title, c.position]))));
    } catch {}
  }

  /** A remote pointing off the TV leaves the cards, the reader's arrows and its links. */
  pointAway(): void {
    for (const card of this.cards) this.leaveCard(card);
    if (this.hoveredArrow) {
      this.readerClips[`${this.hoveredArrow}Off`].play();
      this.hoveredArrow = null;
    }
    if (this.pointedLink) {
      this.pointedLink = null;
      this.colorLinks();
    }
  }

  /** Footer's Back: the letter flies back to its card while the dimmer lifts. */
  closeLetter(): void {
    if (this.state !== 'reading' || !this.open) return;
    this.state = 'closing';
    this.fly = 0;
    this.leaveIn = BACK_FLASH_FRAMES;
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
    this.wheelTo = null;
  }

  /** The wheel glides toward where its notches point, damped like the D-pad's scroll (Scroller::calc). */
  wheel(delta: number): void {
    if (this.state !== 'reading' || this.bOrigin) return;
    this.target = null;
    this.wheelTo = Math.min(this.scrollMax, Math.max(0, (this.wheelTo ?? this.scroll) + delta));
  }

  get reading(): boolean {
    return this.state === 'reading';
  }

  /** While B is held the hand gives way to the scroll marker. */
  get bScrolling(): boolean {
    return this.bOrigin !== null;
  }

  update(frames: number, pointer: { x: number; y: number; a: boolean; b: boolean; aPressed: boolean; bPressed: boolean; sincePress: number | null },
    active: boolean, screen: Screen): void {
    for (const card of this.cards) for (const clip of Object.values(card.clips)) clip.step(frames);
    this.maskIn.step(frames);
    this.maskOut.step(frames);
    if (this.masked && this.state === 'normal' && !this.maskOut.playing) this.masked = false;
    for (const clip of Object.values(this.readerClips)) clip.step(frames);

    if (this.state === 'closing' && this.leaveIn > 0) {
      this.leaveIn -= frames;
      if (this.leaveIn <= 0) {
        // init_fadeout: the letter shrinks back into its card as it flies home.
        this.open!.clips.exit.play();
        this.readerClips.exit.play();
      }
    } else if (this.state === 'opening' || this.state === 'closing') {
      this.fly = Math.min(FLY_FRAMES, this.fly + frames);
      if (this.fly >= FLY_FRAMES) {
        if (this.state === 'opening') {
          this.state = 'reading';
          this.setArrow('down', this.scrollMax > 0);
        } else {
          // The dimmer lifts only once the letter is home.
          this.state = 'normal';
          this.open = null;
          this.maskOut.play();
          this.onClosed?.();
        }
      }
    }

    if (this.state === 'reading') this.updateReader(frames, pointer, active);
    else if (this.pinched) this.updatePinch(pointer, frames, screen, active);
    else if (this.state === 'normal' && active) this.updateCards(pointer, frames, screen);
  }

  private updateCards(pointer: { x: number; y: number; b: boolean; bPressed: boolean; sincePress: number | null },
    frames: number, screen: Screen): void {
    let hit: Card | null = null;
    for (const card of this.cards) if (contains(card.instance.pane('B_Letter'), pointer.x, pointer.y)) hit = card;
    for (const card of this.cards) if (card !== hit) this.leaveCard(card);
    if (hit) this.pointCard(hit);
    if (hit && pointer.bPressed) {
      this.pinch(hit, pointer, screen);
      return;
    }
    const since = pointer.sincePress;
    if (hit && since !== null && since >= DECIDE_AFTER && since - frames < DECIDE_AFTER && !pointer.b) this.openLetter(hit);
  }

  private updateReader(frames: number, pointer: { x: number; y: number; b: boolean; aPressed: boolean },
    active: boolean): void {
    const start = this.scroll;
    // B is a rate control: the farther from where it went down, the faster the letter keeps moving.
    // Once started it outlives the pointer leaving the TV (BScroller::calc). Full speed comes at the picture's
    // edge rather than the remote's slightly farther reach, so the mouse never needs to leave the page.
    if (pointer.b && (active || this.bOrigin)) {
      const edge = SCREEN_HEIGHT / 2;
      const y = Math.min(edge, Math.max(-edge, pointer.y));
      this.bOrigin ??= [pointer.x, y];
      this.bDelta = (this.bOrigin[1] - y) / edge;
      this.bSpeed = Math.abs(this.bDelta) < 0.01 ? 0 : Math.sign(this.bDelta) * 10 * this.bDelta * this.bDelta;
      this.target = null;
      this.wheelTo = null;
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
      this.bDelta = 0;
    }

    if (this.target) {
      this.target.frame = Math.min(ARROW_FRAMES, this.target.frame + frames);
      const t = this.target.frame / ARROW_FRAMES;
      this.scroll = this.target.from + (this.target.to - this.target.from) * t * t * (3 - 2 * t);
      if (this.target.frame >= ARROW_FRAMES) this.target = null;
    }
    if (this.wheelTo !== null) {
      this.scroll += (this.wheelTo - this.scroll) * (1 - 0.6 ** frames);
      if (Math.abs(this.wheelTo - this.scroll) < 0.5) {
        this.scroll = this.wheelTo;
        this.wheelTo = null;
      }
    }
    // The scroll sound holds while the letter moves more than a unit an update; B scrolling ticks instead.
    if (!this.bOrigin && Math.abs(this.scroll - start) > frames) this.sound.hold('WIPL_SE_MESSAGE_SCROLL');
    this.setArrow('up', this.scroll > 0);
    this.setArrow('down', this.scroll < this.scrollMax);

    if (!active || this.bOrigin) return;
    const pointed = this.linkUnder(pointer.x, pointer.y);
    if (pointed !== this.pointedLink) {
      this.pointedLink = pointed;
      if (pointed) this.sound.play('WIPL_SE_BT_TARGETTING');
      this.colorLinks();
    }
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
    // The card in hand is drawn last, over the others.
    const pinched = this.pinched;
    for (const card of pinched ? [...this.cards.filter((c) => c !== pinched.card), pinched.card] : this.cards) {
      const [dx, dy] = card === pinched?.card ? pinched.offset : [0, 0];
      // Cards spread out on a wide screen but aren't stretched.
      card.instance.update(translation((card.position[0] + dx) * (screen.width / 608), card.position[1] + dy), screen);
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
    const [cardX, cardY] = this.open!.position;
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

  drawCursor(screen: Screen): void {
    if (!this.bOrigin) return;
    const [ox, oy] = this.bOrigin;
    this.bScroll.pane('BArwBase').visible = this.bSpeed === 0;
    const arrow = this.bScroll.pane('N_BArw');
    arrow.visible = this.bSpeed !== 0;
    // set_arw_param: scrolling up is POINT_DOWN, a y-scale of +1, which this arrow draws pointing up.
    arrow.scale[1] = this.bSpeed < 0 ? 1 : -1;
    this.bScroll.pane('W_BArw').size[1] = Math.min(128, Math.max(32, Math.abs(this.bDelta) * SCREEN_HEIGHT));
    this.bScroll.update(translation(ox, oy), screen);
    this.renderer.drawLayout(this.bScroll);
  }
}
