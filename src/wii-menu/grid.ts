import type { Assets, Channel } from './assets';
import { Balloon } from './balloon';
import { Carry } from './carry';
import { Clock } from './clock';
import type { Screen } from './display';
import { Footer, type FooterTarget } from './footer';
import { center, contains } from './lyt/hit';
import { AnimationPlayer, identity, type LayoutInstance, type Mtx34, type PaneNode } from './lyt/layout';
import type { Renderer } from './lyt/renderer';
import type { Sound } from './sound';

export const PAGES = 4;
const SLOTS_PER_PAGE = 12;
const RELATIVE_PAGES = 'abcde';
const DECIDE_AFTER = 5;
const CHANNEL_BALLOON_DELAY = 20;
const ORDER_KEY = 'wii-forwarders.order';
const PAGE_KEY = 'wii-forwarders.page';
const OTHER_LANGUAGES = ['JPN', 'GER', 'FRA', 'SPA', 'ITA', 'NED', 'CHN', 'KOR'];

export interface Pointer {
  x: number;
  y: number;
  /** A is the left mouse button; B is the right one. */
  a: boolean;
  b: boolean;
  aPressed: boolean;
  bPressed: boolean;
  /** Updates since A was last pressed, held or not; null once spent or cancelled by B. */
  sincePress: number | null;
}

interface Icon {
  instance: LayoutInstance;
  clip: AnimationPlayer | null;
}

type FocusState = 'hidden' | 'in' | 'held' | 'out';

/** One tile of the current page: its hover frame and name balloon (ChannelObj). */
interface Slot {
  pane: PaneNode;
  focus: LayoutInstance;
  focusOn: AnimationPlayer;
  focusOff: AnimationPlayer;
  state: FocusState;
  queued: 'in' | 'out' | null;
  balloon: Balloon;
}

type State = 'normal' | 'scroll' | 'selected' | 'away' | 'sliding' | 'carry' | 'dropping';

export function translation(x: number, y: number): Mtx34 {
  const m = identity();
  m[3] = x;
  m[7] = y;
  return m;
}

/** The Wii Menu's channel select screen (iplChannelSelect.cpp) with its board backdrop and footer. */
export class ChannelGrid {
  page: number;
  readonly order: (string | null)[];
  readonly footer: Footer;
  state: State = 'normal';
  onSelect: ((channel: Channel, slot: PaneNode) => void) | null = null;
  onBoard: (() => void) | null = null;
  onOptions: (() => void) | null = null;

  private readonly top: LayoutInstance;
  private readonly clock: Clock;
  private readonly icons = new Map<string, Icon>();
  private readonly statics: { instance: LayoutInstance; clip: AnimationPlayer }[] = [];
  private readonly slots: Slot[] = [];
  private readonly scroll: Record<'left' | 'right', AnimationPlayer>;
  private readonly mask: AnimationPlayer;
  private masking = false;
  private readonly slide: Record<'up' | 'down', AnimationPlayer>;
  private readonly carry: Carry;
  private scrolling: -1 | 0 | 1 = 0;
  private hoveredSlot = -1;
  private screen: Screen | null = null;
  private dragFrom: [number, number] | null = null;
  private dragPitch = 1;

  constructor(private readonly assets: Assets, private readonly renderer: Renderer, private readonly sound: Sound) {
    const { chanSel } = assets.menu;
    this.top = chanSel.instance('my_IplTop_a');
    const topClip = chanSel.animation('my_IplTop_a')!;
    this.scroll = {
      left: new AnimationPlayer(topClip, this.top, { from: 0, to: 20 }),
      right: new AnimationPlayer(topClip, this.top, { from: 40, to: 60 }),
    };
    this.mask = new AnimationPlayer(topClip, this.top, { from: 200, to: 228, panes: ['ChMask'] });
    this.slide = {
      up: new AnimationPlayer(topClip, this.top, { from: 70, to: 90, panes: ['N_Ch'] }),
      down: new AnimationPlayer(topClip, this.top, { from: 100, to: 120, panes: ['N_Ch'] }),
    };
    this.top.pane('ChMask').visible = false;

    this.clock = new Clock(chanSel, assets.messages);
    this.footer = new Footer(assets, renderer, sound);

    for (const channel of assets.channels) {
      const instance = channel.icon.instance('icon');
      const animation = channel.icon.animation('icon');
      // Forwarder icons have no module, so the clip's own loop flag decides (createWadThumbnail).
      const clip = animation ? new AnimationPlayer(animation, instance, { loop: animation.loop }).play() : null;
      // Every icon starts somewhere random in its clip.
      if (clip) clip.frame = clip.from + Math.floor(Math.random() * (clip.to - clip.from));
      for (const language of OTHER_LANGUAGES) {
        for (const pane of channel.icon.layout('icon').groups.get(language) ?? []) {
          const node = instance.panes.get(pane);
          if (node) node.visible = false;
        }
      }
      this.icons.set(channel.id, { instance, clip });
    }

    this.order = this.loadOrder();
    this.page = Math.min(PAGES - 1, Number(localStorage.getItem(PAGE_KEY) ?? 0) || 0);

    for (let index = 0; index < SLOTS_PER_PAGE; index++) {
      const focus = chanSel.instance('my_IplTop_d');
      focus.pane('Cursur_a').visible = false;
      this.slots.push({
        pane: this.top.pane(`N_Ch_c${String(index + 1).padStart(2, '0')}`),
        focus,
        focusOn: new AnimationPlayer(chanSel.animation('my_IplTop_d_FocusOn')!, focus),
        focusOff: new AnimationPlayer(chanSel.animation('my_IplTop_d_FocusOff')!, focus),
        state: 'hidden',
        queued: null,
        balloon: new Balloon(chanSel, sound, CHANNEL_BALLOON_DELAY, false),
      });
    }
    this.labelSlots();

    for (const [name, pane] of this.top.panes) {
      const match = /^N_Ch_([a-e])(\d\d)$/.exec(name);
      if (!match) continue;
      const relative = RELATIVE_PAGES.indexOf(match[1]) - 2;
      const index = Number(match[2]) - 1;
      pane.onDraw = (slot) => this.drawThumbnail(slot, relative, index);
    }
    this.footer.placeArrows(this.page, PAGES);
    this.carry = new Carry(chanSel);
  }

  /** The slot order as the visitor last arranged it; channels not placed yet fill the first free slots. */
  private loadOrder(): (string | null)[] {
    const ids = this.assets.channels.map((c) => c.id);
    let saved: (string | null)[] = [];
    try {
      saved = JSON.parse(localStorage.getItem(ORDER_KEY) ?? '[]');
    } catch {}
    const order = Array.from({ length: PAGES * SLOTS_PER_PAGE }, (_, i) => {
      const id = saved[i];
      return id && ids.includes(id) ? id : null;
    });
    for (const id of ids) {
      if (order.includes(id)) continue;
      const free = order.indexOf(null);
      if (free >= 0) order[free] = id;
    }
    return order;
  }

  saveOrder(): void {
    try {
      localStorage.setItem(ORDER_KEY, JSON.stringify(this.order));
    } catch {}
  }

  /** Darkens the grid behind a zooming preview (my_IplTop_a 200–228), or lifts the darkening. */
  zoomMask(darken: boolean): void {
    this.masking = true;
    this.mask.play(!darken);
  }

  /** Where a channel sits: its page and its slot pane on the current page. */
  locate(channel: Channel): { page: number; index: number } {
    const absolute = this.order.indexOf(channel.id);
    return { page: Math.floor(absolute / SLOTS_PER_PAGE), index: absolute % SLOTS_PER_PAGE };
  }

  slotPane(index: number): PaneNode {
    return this.slots[index].pane;
  }

  /** Jumps to a page without sliding, as prepareRestarting does when the preview moved pages. */
  showPage(page: number): void {
    if (page === this.page) return;
    this.page = page;
    this.labelSlots();
    this.footer.placeArrows(this.page, PAGES);
  }

  /** The next channel in slot order, wrapping around and skipping empty slots (searchChannel). */
  neighbor(channel: Channel, direction: -1 | 1): Channel {
    const start = this.order.indexOf(channel.id);
    for (let step = 1; step <= this.order.length; step++) {
      const next = this.channelAt((start + direction * step + this.order.length * 2) % this.order.length);
      if (next) return next;
    }
    return channel;
  }

  channelAt(absolute: number): Channel | null {
    const id = this.order[absolute];
    return id ? this.assets.channels.find((c) => c.id === id) ?? null : null;
  }

  private labelSlots(): void {
    this.slots.forEach((slot, index) => {
      const channel = this.channelAt(this.page * SLOTS_PER_PAGE + index);
      slot.balloon.setText(this.renderer, channel?.name.split('\n')[0] ?? '');
    });
  }

  private emptyStatic(key: number): { instance: LayoutInstance; clip: AnimationPlayer } {
    while (this.statics.length <= key) {
      const instance = this.assets.menu.chanSel.instance('my_IplTop_b');
      const clip = new AnimationPlayer(this.assets.menu.chanSel.animation('my_IplTop_b')!, instance, { loop: true }).play();
      clip.frame = Math.floor(Math.random() * 2000) % clip.to;
      this.statics.push({ instance, clip });
    }
    return this.statics[key];
  }

  /** ChannelSelect::setChannelScissor: 128×96 (170×96 wide) plus one EFB pixel each side. */
  private drawThumbnail(slot: PaneNode, relative: number, index: number): void {
    const screen = this.screen!;
    const page = this.page + relative;
    if (page < 0 || page >= PAGES) return;
    const [x, y] = center(slot);
    const halfWidth = screen.wide ? 85 : 64;
    if (x + halfWidth < -screen.width / 2 || x - halfWidth > screen.width / 2) return;
    const pixel = screen.width / 640;
    this.renderer.setClip([x - halfWidth - pixel, y + 48 + 1, x + halfWidth + pixel, y - 48 - 1]);
    const channel = this.channelAt(page * SLOTS_PER_PAGE + index);
    let instance: LayoutInstance;
    if (channel) {
      instance = this.icons.get(channel.id)!.instance;
    } else {
      const empty = this.emptyStatic((relative + 2) * SLOTS_PER_PAGE + index);
      instance = empty.instance;
    }
    instance.update(translation(x, y), screen);
    this.renderer.drawLayout(instance);
    const absolute = page * SLOTS_PER_PAGE + index;
    this.carry.drawSlot(this.renderer, screen, absolute, channel !== null, x, y);
    this.renderer.setClip(null);
  }

  private slotFocus(slot: Slot, direction: 'in' | 'out'): void {
    if (direction === 'in') {
      if (slot.state === 'hidden') {
        slot.state = 'in';
        slot.focusOn.play();
      } else {
        slot.queued = slot.state === 'out' ? 'in' : null;
      }
    } else if (slot.state === 'held') {
      slot.state = 'out';
      slot.focusOff.play();
    } else if (slot.state === 'in') {
      slot.queued = 'out';
    }
  }

  /** Focus clips never reverse mid-way; a change of mind waits for the current clip to finish. */
  private updateSlot(slot: Slot, frames: number): void {
    const clip = slot.state === 'in' ? slot.focusOn : slot.state === 'out' ? slot.focusOff : null;
    if (!clip) return;
    clip.step(frames);
    if (clip.playing) return;
    const queued = slot.queued;
    slot.queued = null;
    if (slot.state === 'in') {
      slot.state = 'held';
      if (queued === 'out') this.slotFocus(slot, 'out');
    } else {
      slot.state = 'hidden';
      slot.focus.pane('Cursur_a').visible = false;
      if (queued === 'in') this.slotFocus(slot, 'in');
    }
  }

  private resetHovers(): void {
    for (const slot of this.slots) {
      slot.state = 'hidden';
      slot.queued = null;
      slot.focus.pane('Cursur_a').visible = false;
      slot.balloon.hideNow();
    }
    this.hoveredSlot = -1;
    this.footer.releaseAll();
  }

  private pointSlot(index: number): void {
    if (index === this.hoveredSlot) return;
    if (this.hoveredSlot >= 0) {
      this.slotFocus(this.slots[this.hoveredSlot], 'out');
      this.slots[this.hoveredSlot].balloon.leave();
    }
    this.hoveredSlot = index;
    if (index >= 0) {
      this.slotFocus(this.slots[index], 'in');
      this.slots[index].balloon.point();
      this.sound.play('WIPL_SE_CH_TARGETTING');
    }
  }

  get grabbing(): boolean {
    return this.state === 'carry';
  }

  /** The Disc Channel's slot holds the Empty Slot channel here, and like the Disc Channel it never moves. */
  private pinned(absolute: number): boolean {
    return absolute === 0;
  }

  /** startDrag: the right button (A+B) picks up a channel; its slot shows static while it's carried. */
  private pickUp(index: number): void {
    const absolute = this.page * SLOTS_PER_PAGE + index;
    if (!this.channelAt(absolute) || this.pinned(absolute)) return;
    for (const [i, slot] of this.slots.entries()) {
      slot.balloon.hideNow();
      if (i !== index) {
        slot.state = 'hidden';
        slot.queued = null;
        slot.focus.pane('Cursur_a').visible = false;
      }
    }
    this.footer.releaseAll();
    this.carry.start(absolute);
    this.state = 'carry';
    this.hoveredSlot = index;
    this.dragFrom = null;
    this.dragPitch = 1;
    this.sound.play('WIPL_SE_CH_HOLD');
  }

  /** moveDrag: the carry hum gets louder and higher the faster the hand moves, and pans with it. */
  private holdDragSound(frames: number, pointer: Pointer, valid: boolean): void {
    if (!valid) {
      this.dragFrom = null;
      this.dragPitch = 1;
      return;
    }
    const [x, y] = this.dragFrom ?? [pointer.x, pointer.y];
    this.dragFrom = [pointer.x, pointer.y];
    const moved = Math.hypot(pointer.x - x, pointer.y - y) / Math.max(frames, 1e-3);
    if (moved > 30) this.dragPitch = moved / 30;
    // holdSEwithPosDis divides by the 4:3 half-width even on a widescreen TV.
    this.sound.hold('WIPL_SE_CH_DRAG', { pan: pointer.x / 304, volume: Math.min(1, (2 * moved) / 304), pitch: this.dragPitch });
  }

  /** A drop is legal on an empty slot or back on its own slot; there is no swapping. */
  private drop(index: number | null, x: number): void {
    const source = this.carry.source;
    const pan = x / ((this.screen?.width ?? 608) / 2);
    const target = index === null ? null : this.page * SLOTS_PER_PAGE + index;
    const legal = target !== null && (target === source || (this.order[target] === null && !this.pinned(target)));
    this.state = 'dropping';
    if (legal) {
      this.sound.play('WIPL_SE_CH_SET', pan);
      this.carry.land(target, () => {
        if (target === source) return;
        this.order[target] = this.order[source];
        this.order[source] = null;
        this.saveOrder();
        this.labelSlots();
      });
    } else {
      this.sound.play('WIPL_SE_CH_NOT_MOVE', pan);
      this.carry.refuse();
    }
    for (const slot of this.slots) {
      slot.state = 'hidden';
      slot.queued = null;
      slot.focus.pane('Cursur_a').visible = false;
    }
    this.hoveredSlot = -1;
  }

  private updateCarry(frames: number, pointer: Pointer): void {
    this.carry.follow(pointer.x, pointer.y);
    if (this.state === 'scroll') return;
    // Edge paging: resting on a shown page arrow for 15 updates turns the page under the carried tile.
    const arrow = this.footer.hitArrow(pointer.x, pointer.y);
    if (arrow !== this.footer.hovered) {
      if (this.footer.hovered) this.footer.leave(this.footer.hovered);
      if (arrow) this.footer.point(arrow);
    }
    if (this.carry.dwell(arrow, frames) && arrow) {
      this.footer.press(arrow);
      this.state = 'normal';
      this.startScroll(arrow === 'left' ? -1 : 1);
      this.state = 'scroll';
      return;
    }
    // Legal targets light their focus frame; occupied slots stay dark.
    let index = -1;
    if (!arrow) {
      index = this.slots.findIndex((slot) => contains(slot.pane, pointer.x, pointer.y));
      const absolute = this.page * SLOTS_PER_PAGE + index;
      const legal = index >= 0 && (absolute === this.carry.source || (this.order[absolute] === null && !this.pinned(absolute)));
      if (!legal) index = -1;
    }
    if (index !== this.hoveredSlot) {
      if (this.hoveredSlot >= 0) this.slotFocus(this.slots[this.hoveredSlot], 'out');
      this.hoveredSlot = index;
      if (index >= 0) {
        this.slotFocus(this.slots[index], 'in');
        this.sound.play('WIPL_SE_CH_TARGETTING');
      }
    }
    if (!pointer.b && this.carry.ready) {
      const under = this.slots.findIndex((slot) => contains(slot.pane, pointer.x, pointer.y));
      this.drop(under >= 0 ? under : null, pointer.x);
    }
  }

  startScroll(direction: -1 | 1): void {
    const next = this.page + direction;
    if (this.state !== 'normal' || next < 0 || next >= PAGES) return;
    this.resetHovers();
    this.state = 'scroll';
    this.scrolling = direction;
    this.scroll[direction < 0 ? 'left' : 'right'].play();
  }

  private finishScroll(): void {
    this.page += this.scrolling;
    this.top.pane('N_ChAll').translate[0] = 0;
    this.scrolling = 0;
    this.state = this.carry.active ? 'carry' : 'normal';
    this.labelSlots();
    this.footer.updateArrows(this.page, PAGES);
    try {
      localStorage.setItem(PAGE_KEY, String(this.page));
    } catch {}
  }

  update(frames: number, pointer: Pointer, active: boolean): void {
    for (const icon of this.icons.values()) icon.clip?.step(frames);
    for (const empty of this.statics) empty.clip.step(frames);
    for (const slot of this.slots) {
      this.updateSlot(slot, frames);
      slot.balloon.update(frames);
    }
    this.clock.update(frames);
    this.footer.update(frames);
    if (this.masking) {
      this.mask.step(frames);
      if (!this.mask.playing && this.mask.backward) this.masking = false;
    }

    if (this.state === 'sliding') {
      const clip = this.slide.up.playing ? this.slide.up : this.slide.down;
      clip.step(frames);
      if (!this.slide.up.playing && !this.slide.down.playing) {
        if (clip === this.slide.up) this.state = 'away';
        else this.resume();
      }
    }
    this.carry.update(frames);
    if (this.state === 'scroll') {
      const clip = this.scroll[this.scrolling < 0 ? 'left' : 'right'];
      clip.step(frames);
      if (this.carry.active) {
        this.carry.follow(pointer.x, pointer.y);
        this.holdDragSound(frames, pointer, active);
      }
      if (!clip.playing) {
        this.finishScroll();
        // Letting go during the slide is an illegal drop once the slide ends.
        if (this.carry.active && !pointer.b) this.drop(null, pointer.x);
      }
    }
    if (this.state === 'dropping' && !this.carry.busy) this.state = 'normal';
    if (this.state === 'carry') {
      this.holdDragSound(frames, pointer, active);
      this.updateCarry(frames, pointer);
      return;
    }
    if (this.state !== 'normal' || !active || !this.screen) return;

    const footerTarget = this.footer.hit(pointer.x, pointer.y);
    if (footerTarget !== this.footer.hovered) {
      if (this.footer.hovered) this.footer.leave(this.footer.hovered);
      if (footerTarget) this.footer.point(footerTarget);
    }
    let slotIndex = -1;
    if (!footerTarget) {
      slotIndex = this.slots.findIndex((slot, i) => (
        contains(slot.pane, pointer.x, pointer.y) && this.channelAt(this.page * SLOTS_PER_PAGE + i) !== null
      ));
    }
    this.pointSlot(slotIndex);

    if (pointer.bPressed && slotIndex >= 0) {
      this.pickUp(slotIndex);
      return;
    }
    if (pointer.aPressed && footerTarget) this.pressFooter(footerTarget);
    // decide() opens a channel on the fifth update after A; a mouse click is often shorter than that.
    const since = pointer.sincePress;
    const decided = since !== null && since >= DECIDE_AFTER && since - frames < DECIDE_AFTER;
    if (slotIndex >= 0 && decided && !pointer.b) this.select(slotIndex);
  }

  private pressFooter(target: FooterTarget): void {
    this.footer.press(target);
    if (target === 'left') this.startScroll(-1);
    else if (target === 'right') this.startScroll(1);
    else if (target === 'board') this.onBoard?.();
    else if (target === 'options') this.onOptions?.();
  }

  private select(index: number): void {
    const channel = this.channelAt(this.page * SLOTS_PER_PAGE + index);
    if (!channel) return;
    this.sound.play('WIPL_SE_BT_PUSH');
    this.state = 'selected';
    this.resetHovers();
    this.onSelect?.(channel, this.slots[index].pane);
  }

  /** To the Message Board: the tiles, frames, bottom bar and clock slide up off the screen. */
  slideAway(): void {
    this.resetHovers();
    this.state = 'sliding';
    this.slide.up.play();
  }

  /** Back from the board: the grid slides down into place. */
  slideBack(): void {
    this.state = 'sliding';
    this.slide.down.play();
  }

  get visible(): boolean {
    return this.state !== 'away';
  }

  /** Back from the preview or the board: the grid takes input again. */
  resume(): void {
    this.state = 'normal';
    this.footer.updateArrows(this.page, PAGES);
  }

  draw(screen: Screen): void {
    this.screen = screen;
    if (this.state === 'away') return;
    const view = identity();
    // ChannelSelect::draw: slot backdrops, thumbnails, then frames and the bottom bar over them.
    for (let relative = -2; relative <= 2; relative++) {
      const page = this.page + relative;
      const edge = this.top.panes.get(`Edge${relative + 2}`);
      if (edge && relative !== 0) edge.visible = page >= 0 && page < PAGES;
    }
    this.top.update(view, screen);
    const isMask = (pane: PaneNode) => pane.name.startsWith('BaseMask');
    this.renderer.drawLayout(this.top, (pane) => pane.source.kind !== 'pic1' || isMask(pane));
    this.renderer.drawLayout(this.top, (pane) => pane.source.kind === 'pic1' && !isMask(pane));
    this.clock.draw(this.renderer, screen, ['N_Clock0', 'N_Clock1', 'N_Clock2'].map((n) => this.top.pane(n)));

    for (const slot of this.slots) {
      if (slot.state === 'hidden') continue;
      (slot.state === 'out' ? slot.focusOff : slot.focusOn).apply();
      slot.focus.update(translation(...center(slot.pane)), screen);
      this.renderer.drawLayout(slot.focus);
    }
    for (const slot of this.slots) {
      const [x, y] = center(slot.pane);
      slot.balloon.draw(this.renderer, screen, x, y - 70, 60);
    }
    if (this.masking) {
      const mask = this.top.pane('ChMask');
      mask.visible = true;
      this.top.update(view, screen);
      this.renderer.drawLayout(this.top, (pane) => pane === mask);
      mask.visible = false;
    }
    this.carry.drawTile(this.renderer, screen);
  }
}
