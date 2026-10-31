import type { Assets, SdChannel } from './assets';
import { Balloon } from './balloon';
import { CardPanel } from './card-panel';
import { perMode, type Screen } from './display';
import { FocusFrame } from './focus';
import { forecastIcon } from './forecast';
import { translation, type Pointer } from './grid';
import { center, contains } from './lyt/hit';
import { AnimationPlayer, identity, type LayoutInstance, type PaneNode } from './lyt/layout';
import type { Renderer } from './lyt/renderer';
import { SdFooter, type SdFooterTarget } from './sd-footer';
import type { Sound } from './sound';
import { WideGrid } from './wide';

export const SD_PAGES = 20;
const SLOTS_PER_PAGE = 12;
const RELATIVE_PAGES = 'abcde';
const DECIDE_AFTER = 5;
const CHANNEL_BALLOON_DELAY = 20;
// A card with channels keeps its loading panel up for at least a second (busClock / 4).
const CARD_GATE = 60;
const PAGE_KEY = 'wii-forwarders.sd-page';
const OTHER_LANGUAGES = ['JPN', 'GER', 'FRA', 'SPA', 'ITA', 'NED', 'CHN', 'KOR'];
// In 16:9 the tile frames and the page edges take their wide textures from these off-screen panes.
const WIDE_DONORS: [string, string[]][] = [
  ['ChangeTex16x9', ['Picture_00', 'Picture_01', 'Picture_02', 'Picture_03', 'Picture_04']],
  ['Picture_16', ['Edge0', 'Edge1', 'Edge2', 'Edge3', 'Edge4']],
];

interface Tile {
  instance: LayoutInstance;
  clip: AnimationPlayer | null;
}

interface Slot {
  pane: PaneNode;
  focus: FocusFrame;
  balloon: Balloon;
}

type State = 'normal' | 'scroll' | 'selected';

/**
 * The SD Card Menu's grid (SDChannelSelect, SDChannelObj): 20 pages of 12 slots on a dark board,
 * the page number where the Wii Menu has its clock, and the loading panel while the card is read.
 */
export class SdGrid {
  page: number;
  state: State = 'normal';
  readonly footer: SdFooter;
  onSelect: ((channel: SdChannel) => void) | null = null;
  onHelp: (() => void) | null = null;
  onWiiMenu: (() => void) | null = null;

  private readonly top: LayoutInstance;
  private readonly counter: LayoutInstance;
  private readonly panel: CardPanel;
  private readonly icons = new Map<string, Tile>();
  private readonly statics: Tile[] = [];
  private readonly slots: Slot[] = [];
  private readonly scroll: Record<'left' | 'right', AnimationPlayer>;
  private readonly mask: AnimationPlayer;
  private masking = false;
  private scrolling: -1 | 0 | 1 = 0;
  private hoveredSlot = -1;
  /** Until the card has been read, every slot shows static. */
  private loaded = false;
  private reading = false;
  private wide: boolean | null = null;
  private screen: Screen | null = null;
  private readonly wideGrid: WideGrid;

  constructor(private readonly assets: Assets, private readonly renderer: Renderer, private readonly sound: Sound) {
    const { sdChanSel } = assets.menu;
    this.top = sdChanSel.instance('mn_SdcardMenu_a');
    const topClip = sdChanSel.animation('mn_SdcardMenu_a')!;
    this.scroll = {
      left: new AnimationPlayer(topClip, this.top, { from: 0, to: 20 }),
      right: new AnimationPlayer(topClip, this.top, { from: 40, to: 60 }),
    };
    this.mask = new AnimationPlayer(topClip, this.top, { from: 200, to: 228, panes: ['ChMask'] });
    this.top.pane('ChMask').visible = false;
    this.counter = sdChanSel.instance('mn_SdcardMenu_Page');
    this.panel = new CardPanel(sdChanSel, assets.messages['170']);
    this.footer = new SdFooter(assets, renderer, sound);

    for (const channel of assets.sdChannels) {
      const instance = channel.icon.instance('icon');
      const animation = channel.icon.animation('icon') ?? channel.icon.animation('icon_Whole');
      const clip = animation
        ? new AnimationPlayer(animation, instance, { loop: animation.loop, wholeFrames: true }).play()
        : null;
      if (clip) clip.frame = clip.from + Math.floor(Math.random() * (clip.to - clip.from));
      for (const language of OTHER_LANGUAGES) {
        for (const pane of channel.icon.layout('icon').groups.get(language) ?? []) {
          const node = instance.panes.get(pane);
          if (node) node.visible = false;
        }
      }
      this.icons.set(channel.id, { instance, clip: clip ?? forecastIcon(channel, instance) });
    }

    let saved = 0;
    try {
      saved = Number(localStorage.getItem(PAGE_KEY) ?? 0) || 0;
    } catch {}
    this.page = Math.max(0, Math.min(SD_PAGES - 1, saved));

    for (let index = 0; index < SLOTS_PER_PAGE; index++) {
      this.slots.push({
        pane: this.top.pane(`N_Ch_c${String(index + 1).padStart(2, '0')}`),
        focus: new FocusFrame(sdChanSel),
        balloon: new Balloon(sdChanSel, sound, CHANNEL_BALLOON_DELAY, false),
      });
    }
    this.wideGrid = new WideGrid(this.top);
    for (const [name, pane] of this.top.panes) {
      const match = /^N_Ch_([a-e])(\d\d)$/.exec(name);
      if (!match) continue;
      const relative = RELATIVE_PAGES.indexOf(match[1]) - 2;
      const index = Number(match[2]) - 1;
      pane.onDraw = (slot) => this.drawThumbnail(slot, relative, index);
    }
    this.footer.placeArrows(this.page, SD_PAGES);
  }

  channelAt(absolute: number): SdChannel | null {
    return this.loaded ? this.assets.sdChannels[absolute] ?? null : null;
  }

  /** Where a channel sits: the card's channels fill the first slots in their order. */
  locate(channel: SdChannel): { page: number; index: number } {
    const absolute = this.assets.sdChannels.indexOf(channel);
    return { page: Math.floor(absolute / SLOTS_PER_PAGE), index: absolute % SLOTS_PER_PAGE };
  }

  slotPane(index: number): PaneNode {
    return this.slots[index].pane;
  }

  /** The next channel over all 240 slots, wrapping and skipping empty ones (iplSDChannelSelect_813DDBB4). */
  neighbor(channel: SdChannel, direction: -1 | 1): SdChannel {
    const total = SD_PAGES * SLOTS_PER_PAGE;
    const start = this.assets.sdChannels.indexOf(channel);
    for (let step = 1; step <= total; step++) {
      const next = this.channelAt((start + direction * step + total) % total);
      if (next) return next;
    }
    return channel;
  }

  /** mount_sd_async: the loading panel comes in and holds; the channels appear as it goes. */
  readCard(): void {
    this.reading = true;
    this.panel.show();
  }

  private updateCard(frames: number): void {
    this.panel.update(frames);
    if (!this.reading || this.panel.held === null || this.panel.held < CARD_GATE || !this.panel.idle) return;
    this.reading = false;
    this.panel.close();
    this.loaded = true;
    this.labelSlots();
  }

  private labelSlots(): void {
    this.slots.forEach((slot, index) => {
      slot.balloon.setText(this.renderer, this.channelAt(this.page * SLOTS_PER_PAGE + index)?.name ?? '');
    });
  }

  /** Each empty slot runs its own static from a random frame (iplSDChannelObj_813E3A84). */
  private emptyStatic(key: number): Tile {
    const archive = this.assets.menu.sdChanSel;
    while (this.statics.length <= key) {
      const instance = archive.instance('mn_SdcardMenu_d');
      const clip = new AnimationPlayer(archive.animation('mn_SdcardMenu_d')!, instance, { loop: true }).play();
      clip.frame = Math.floor(Math.random() * 2000) % clip.to;
      this.statics.push({ instance, clip });
    }
    return this.statics[key];
  }

  /** The slot's scissor, 128×96 (170×96 wide) plus one EFB pixel each side, then its icon or static. */
  private drawThumbnail(slot: PaneNode, relative: number, index: number): void {
    const screen = this.screen!;
    const page = this.page + relative;
    if (page < 0 || page >= SD_PAGES) return;
    const [x, y] = center(slot);
    const halfWidth = perMode(screen, 64, 85);
    if (x + halfWidth < -screen.width / 2 || x - halfWidth > screen.width / 2) return;
    const pixel = screen.projection / 640;
    this.renderer.setClip([x - halfWidth - pixel, y + 48 + 1, x + halfWidth + pixel, y - 48 - 1]);
    const channel = this.channelAt(page * SLOTS_PER_PAGE + index);
    const tile = channel ? this.icons.get(channel.id)! : this.emptyStatic((relative + 2) * SLOTS_PER_PAGE + index);
    tile.instance.update(translation(x, y), screen.tv);
    this.renderer.drawLayout(tile.instance);
    this.renderer.setClip(null);
  }

  /** Darkens the grid behind a zooming preview (mn_SdcardMenu_a 200–228), or lifts the darkening. */
  zoomMask(darken: boolean): void {
    this.masking = true;
    this.mask.play(!darken);
  }

  /** Back from a preview that moved to another page: the grid jumps there without sliding. */
  showPage(page: number): void {
    if (page === this.page) return;
    this.page = page;
    this.labelSlots();
  }

  /** Back from the preview: the footer answers again and the arrows follow the page. */
  resume(): void {
    this.state = 'normal';
    this.footer.enable();
    this.footer.updateArrows(this.page, SD_PAGES);
  }

  /** Focus frames and balloons go at once when the grid leaves its normal state. */
  private resetHovers(): void {
    for (const slot of this.slots) {
      slot.focus.hide();
      slot.balloon.hideNow();
    }
    this.hoveredSlot = -1;
  }

  private pointSlot(index: number): void {
    if (index === this.hoveredSlot) return;
    if (this.hoveredSlot >= 0) {
      this.slots[this.hoveredSlot].focus.leave();
      this.slots[this.hoveredSlot].balloon.leave();
    }
    this.hoveredSlot = index;
    if (index >= 0) {
      this.slots[index].focus.point();
      this.slots[index].balloon.point();
      this.sound.play('WIPL_SE_CH_TARGETTING');
      const channel = this.channelAt(this.page * SLOTS_PER_PAGE + index);
      if (channel) this.sound.prepareBanner(`sd-channels/${channel.id}`);
    }
  }

  private startScroll(direction: -1 | 1): void {
    const next = this.page + direction;
    if (next < 0 || next >= SD_PAGES) return;
    this.resetHovers();
    this.state = 'scroll';
    this.scrolling = direction;
    this.scroll[direction < 0 ? 'left' : 'right'].play();
  }

  private finishScroll(): void {
    this.page += this.scrolling;
    this.top.pane('N_ChAll').translate[0] = 0;
    this.scrolling = 0;
    this.state = 'normal';
    this.labelSlots();
    this.footer.updateArrows(this.page, SD_PAGES);
    try {
      localStorage.setItem(PAGE_KEY, String(this.page));
    } catch {}
  }

  private pressFooter(target: SdFooterTarget): void {
    if (target === 'left' || target === 'right') {
      this.footer.pressArrow(target);
      this.startScroll(target === 'left' ? -1 : 1);
    } else if (target === 'help') {
      this.footer.pressHelp();
      this.onHelp?.();
    } else {
      // The Wii button has a press flash in the layout, but nothing plays it.
      this.sound.play('WIPL_SE_DECIDE');
      this.onWiiMenu?.();
    }
  }

  private select(index: number): void {
    const channel = this.channelAt(this.page * SLOTS_PER_PAGE + index);
    if (!channel) return;
    this.sound.play('WIPL_SE_BT_PUSH');
    this.state = 'selected';
    this.resetHovers();
    this.onSelect?.(channel);
  }

  /** `active` is the normal state with the fader idle and no dialog: the footer's and the tiles' GUIs run. */
  /** A remote pointing off the TV leaves whatever it was on: the tile, its balloon, a footer button. */
  pointAway(): void {
    if (this.state !== 'normal') return;
    this.pointSlot(-1);
    if (this.footer.hovered) this.footer.leave(this.footer.hovered);
  }

  update(frames: number, pointer: Pointer, active: boolean): void {
    for (const icon of this.icons.values()) icon.clip?.step(frames);
    for (const empty of this.statics) empty.clip?.step(frames);
    for (const slot of this.slots) {
      slot.focus.update(frames);
      slot.balloon.update(frames);
    }
    this.footer.update(frames);
    this.updateCard(frames);
    if (this.masking) {
      this.mask.step(frames);
      if (!this.mask.playing && this.mask.backward) this.masking = false;
    }
    if (this.state === 'scroll') {
      const clip = this.scroll[this.scrolling < 0 ? 'left' : 'right'];
      clip.step(frames);
      if (!clip.playing) this.finishScroll();
    }
    if (this.state !== 'normal' || !active || !this.screen) return;

    const footer = this.footer;
    const target = footer.hit(pointer.x, pointer.y);
    if (target !== footer.hovered) {
      if (footer.hovered) footer.leave(footer.hovered);
      if (target) footer.point(target);
    }
    let slotIndex = -1;
    if (!target) {
      slotIndex = this.slots.findIndex((slot, i) => (
        contains(slot.pane, pointer.x, pointer.y) && this.channelAt(this.page * SLOTS_PER_PAGE + i) !== null
      ));
    }
    this.pointSlot(slotIndex);
    // The card is write-protected, so a channel can't be picked up here.
    if (pointer.bPressed && slotIndex >= 0) return;
    if (pointer.aPressed && target) {
      this.pressFooter(target);
      return;
    }
    // decide() opens a channel on the fifth update after A, as on the Wii Menu's grid.
    const since = pointer.sincePress;
    const decided = since !== null && since >= DECIDE_AFTER && since - frames < DECIDE_AFTER;
    if (slotIndex >= 0 && decided && !pointer.b) this.select(slotIndex);
  }

  draw(screen: Screen): void {
    this.screen = screen;
    if (screen.wide !== this.wide) this.useWideTextures(screen.wide);
    // Edge0/1 stand for the pages before this one and Edge3/4 for those after; Edge2 is never touched.
    const before = this.page > 0;
    const after = this.page < SD_PAGES - 1;
    // A window wider than 16:9 can see two pages over, so those edges need a page of their own.
    for (const [index, shown] of [
      [0, this.page > 1],
      [1, before],
      [3, after],
      [4, this.page < SD_PAGES - 2],
    ] as const) {
      this.top.pane(`Edge${index}`).visible = shown;
    }
    const view = identity();
    this.wideGrid.place(screen);
    this.top.update(view, screen.tv);
    // SDChannelSelect::draw: slot backdrops and thumbnails, then the frames, strips and bar over them.
    const isMask = (pane: PaneNode) => pane.name.startsWith('BaseMask');
    this.wideGrid.draw(this.renderer, screen, () => {
      this.renderer.drawLayout(this.top, (pane) => pane.source.kind !== 'pic1' || isMask(pane));
      this.renderer.drawLayout(this.top, (pane) => pane.source.kind === 'pic1' && !isMask(pane));
      // One page number layout, drawn at each N_Clock anchor so a copy rides in with the next page.
      for (let i = 0; i < 3; i++) {
        const anchor = this.top.pane(`N_Clock${i}`);
        this.counter.pane('TextBox_00').text = String(this.page + i);
        // Each number rides with its page's dip in the bar, which spreads with a window wider than 16:9.
        this.counter.update(translation((screen.width / screen.projection) * anchor.world[3], anchor.world[7]), screen);
        this.renderer.drawLayout(this.counter);
      }
    });

    for (const slot of this.slots) slot.focus.draw(this.renderer, screen, ...center(slot.pane));
    for (const slot of this.slots) {
      const [x, y] = center(slot.pane);
      slot.balloon.draw(this.renderer, screen, x, y - 70, 60);
    }
    if (this.masking) {
      const mask = this.top.pane('ChMask');
      mask.visible = true;
      this.top.update(view, screen.tv);
      this.renderer.drawLayout(this.top, (pane) => pane === mask);
      mask.visible = false;
    }
    this.panel.draw(this.renderer, screen);
  }

  /** SDChannelSelect copies the wide textures into the frames and edges on a 16:9 TV. */
  private useWideTextures(wide: boolean): void {
    this.wide = wide;
    const material = (name: string) => this.top.materials[this.top.pane(name).source.picture!.material];
    for (const [donor, targets] of WIDE_DONORS) {
      for (const target of targets) {
        const state = material(target);
        state.textures[0] = wide
          ? material(donor).textures[0]
          : this.top.layout.textures[state.source.texMaps[0].texture];
      }
    }
  }
}
