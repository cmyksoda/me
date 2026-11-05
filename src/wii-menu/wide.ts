import type { Pane } from './lyt/brlyt';
import { wings, type Screen } from './display';
import { identity, type LayoutInstance, type MaterialState, type PaneNode } from './lyt/layout';
import type { Rect, Renderer } from './lyt/renderer';

// How far a pane is drawn out from the console picture's edge, so its column there covers the window beyond.
const DRAW_OUT = 1000;
// The sine of the angle a pane turns from flat before it counts as swinging.
const TILT = 0.01;

/** Copies the 16:9 textures from donor panes onto the panes they stand in for, or puts the 4:3 ones back. */
export function useWideTextures(instance: LayoutInstance, donors: [string, string[]][], wide: boolean): void {
  for (const [donor, targets] of donors) {
    const wideTexture = instance.materials[instance.pane(donor).source.picture!.material].textures[0];
    for (const target of targets) {
      const material = instance.materials[instance.pane(target).source.picture!.material];
      material.textures[0] = wide ? wideTexture : instance.layout.textures[material.source.texMaps[0].texture];
    }
  }
}

/** Widens a full-screen pane (a dimmer, a backdrop) to a window wider than the projection. */
export function cover(pane: PaneNode, screen: Screen): void {
  const width = pane.source.size[0];
  pane.size[0] = screen.window > screen.projection ? Math.max(width, (608 * screen.window) / screen.projection) : width;
}

/** Spreads side-by-side full-screen pages with a window wider than the projection, each widened to meet the next. */
export function spreadPages(instance: LayoutInstance, names: string[], screen: Screen): void {
  const spread = screen.window / screen.projection;
  for (const name of names) {
    const { source, translate, size } = instance.pane(name);
    translate[0] = spread === 1 ? source.translate[0] : spread * source.translate[0];
    size[0] = spread === 1 ? source.size[0] : spread * source.size[0];
  }
}

/**
 * Contained, draws some of a layout's panes over the window either side of the console picture: each one
 * crossing the picture's edge is drawn out along its own length from there, as if it ran on to the window's edge.
 * `only` also gets where the edge crosses the pane, as a share of its width from its own left edge.
 */
export function drawWings(
  renderer: Renderer,
  screen: Screen,
  instance: LayoutInstance,
  only: (pane: PaneNode, across: number) => boolean,
): void {
  for (const side of wings(screen)) {
    const edge = side[0] < 0 ? side[2] : side[0];
    const worlds = new Map<PaneNode, Float32Array>();
    const find = (pane: PaneNode) => {
      if (!pane.visible) return;
      const across = shareAcross(pane, edge);
      if (across >= 0 && across <= 1 && only(pane, across)) worlds.set(pane, pane.world.slice());
      pane.children.forEach(find);
    };
    find(instance.root);
    for (const pane of worlds.keys()) drawOut(pane, edge);
    renderer.within(side, () => renderer.drawLayout(instance, (pane) => worlds.has(pane)));
    for (const [pane, world] of worlds) pane.world.set(world);
  }
}

const subtree = (pane: PaneNode): PaneNode[] => [pane, ...pane.children.flatMap(subtree)];

/** A pane turned away from flat, as the footer pods are while they swing round. */
export function tilted(pane: PaneNode): boolean {
  const m = pane.world;
  return Math.abs(m[4]) > TILT * Math.hypot(m[0], m[4]);
}

/** Makes a rail `extra` units longer at its outer end (−1 left, 1 right): the middle stretches and the cap moves. */
export function lengthenRail(middle: PaneNode, outerCap: PaneNode, outward: -1 | 1, extra: number): void {
  const m = middle.world;
  const width = middle.size[0];
  const left = -((middle.source.origin % 3) / 2) * width;
  const fixed = outward < 0 ? left + width : left;
  const stretch = (width + extra) / width;
  for (const row of [0, 4, 8]) {
    outerCap.world[row + 3] += m[row] * outward * extra;
    m[row + 3] += m[row] * fixed * (1 - stretch);
    m[row] *= stretch;
  }
}

/** Panes that move together, and how far past the picture's edge their middle is when the layout parks them. */
export type Slide = [names: string[], parkedPast: number];

/** The page arrows of the footer layouts, which hide and show by sliding out past the picture's edge. */
export const PAGE_ARROWS: Slide[] = [[['N_ArwL_End'], 160], [['N_ArwR__End'], 160]];

/**
 * Panes that slide in from past the console picture's edge (footer pods, page arrows). Contained, the rest of the
 * layout is cut at the picture's edge as a TV's would be, but these draw whole over the window beside it.
 */
export class Sliders {
  private readonly units: { panes: PaneNode[]; parkedPast: number }[];
  private readonly panes = new Set<PaneNode>();

  /** `rail` names the sliders' panes that stay cut at the picture's edge, because `drawWings` runs them on. */
  constructor(
    private readonly instance: LayoutInstance,
    slides: Slide[],
    private readonly rail?: RegExp,
  ) {
    this.units = slides.map(([names, parkedPast]) => ({ panes: names.map((name) => instance.pane(name)), parkedPast }));
    for (const pane of this.units.flatMap((unit) => unit.panes).flatMap(subtree)) this.panes.add(pane);
  }

  /**
   * Runs `inPicture` with the sliders (and any pane `whole` names) whole and the rest of the layout cut at the
   * picture's edge, then `beyond` with no cut. A unit speeds on out of the window as it nears its parking place, as
   * spreading the layout would, so it never rests in view where the console has it off screen. On a swinging pod it
   * stays put and fades instead, the further past the picture's edge and the flatter the pod, so it's gone by the
   * time the pod lies flat and would push it away.
   */
  draw(screen: Screen, inPicture: () => void, beyond?: () => void, whole?: (pane: PaneNode) => boolean): void {
    const moved: [PaneNode, number][] = [];
    const faded: [PaneNode, number][] = [];
    if (screen.contained) {
      const spread = screen.window / screen.projection;
      for (const { panes, parkedPast } of this.units) {
        const m = panes[0].world;
        const x = m[3];
        const toPark = Math.min(1, Math.max(0, (Math.abs(x) - screen.projection / 2) / parkedPast));
        const unit = panes.flatMap(subtree);
        if (tilted(panes[0])) {
          const flat = (m[0] * m[0]) / (m[0] * m[0] + m[4] * m[4]);
          for (const pane of unit) faded.push([pane, pane.globalAlpha]);
          for (const pane of unit) pane.globalAlpha *= 1 - toPark * flat;
          continue;
        }
        const shift = Math.sign(x) * (spread - 1) * Math.abs(x) * toPark;
        for (const pane of unit) moved.push([pane, shift]);
      }
    }
    for (const [pane, shift] of moved) pane.world[3] += shift;
    const all = subtree(this.instance.root);
    for (const pane of all) {
      const free = (this.panes.has(pane) && !this.rail?.test(pane.name)) || whole?.(pane);
      pane.bounds = free ? null : screen.contained;
    }
    inPicture();
    for (const pane of all) pane.bounds = null;
    beyond?.();
    for (const [pane, shift] of moved) pane.world[3] -= shift;
    for (const [pane, alpha] of faded) pane.globalAlpha = alpha;
  }
}

/** Where a pane's middle line meets x = edge, in its own units along it. */
const crossing = (pane: PaneNode, edge: number) => (edge - pane.world[3]) / pane.world[0];

/** Where x = edge meets a pane, as a share of its width from its own left edge; outside 0 to 1 it misses. */
function shareAcross(pane: PaneNode, edge: number): number {
  const left = -((pane.source.origin % 3) / 2) * pane.size[0];
  return (crossing(pane, edge) - left) / pane.size[0];
}

/** Stretches a pane's world matrix along its own x axis about where it meets x = edge. */
function drawOut(pane: PaneNode, edge: number): void {
  const m = pane.world;
  const shift = crossing(pane, edge) * (1 - DRAW_OUT);
  for (const row of [0, 4, 8]) {
    m[row + 3] += m[row] * shift;
    m[row] *= DRAW_OUT;
  }
}

const BAR = ['Shade', 'board', 'Line'];
// A page's own panes: its slots, where its tiles draw, and its frames.
const PAGE_ONLY = /^(N_Ch_[a-e]\d\d|Edge\d)$/;
// Each page's striped TV sheet, lit in its middle, under its tiles.
const PAGE_BACKDROP = /^BaseMask\d$/;
// The same sheet over the tiles, with holes that round their corners, so it has to slide with them.
const PLATE = /^Picture_0[0-4]$/;
// A strip of the sheet above the tiles, which covers their top edge, so it draws after them.
const BAND = /^Picture_0[5-9]$/;
const GX_REPEAT = 1;
// An empty rectangle, for panes already drawn another way.
const DRAWN: Rect = [0, 0, 0, 0];
// From this shape (sideways phones, ultrawide monitors; not a desktop browser window) pages fade out at the picture's
// edges instead of stopping at a hard line.
const FADE_FROM = 2.1;
// The share of each strip beside the pages' window that the fade spans; past it only the backdrop shows.
const FADE_SHARE = 0.5;
// The far pages' slots the grid layouts leave out: x of each missing column, and the slot numbers per row.
const FAR_SLOTS: [string, [number, number[]][]][] = [
  ['a', [[-192, [1, 5, 9]], [-64, [2, 6, 10]], [64, [3, 7, 11]]]],
  ['e', [[-64, [2, 6, 10]], [64, [3, 7, 11]], [192, [4, 8, 12]]]],
];
const ROWS = [175, 79, -17];

/**
 * What a channel grid layout (my_IplTop_a, mn_SdcardMenu_a) needs past 16:9: slots for more of the far
 * pages' tiles, a bottom bar whose page curves spread with the window like the pods, with flat bar
 * between them, and a zoom dimmer as wide as the window. Contained, it keeps the pages in the console
 * picture instead, with only the backdrop and the bar around it.
 */
export class WideGrid {
  private readonly bar: { pane: PaneNode; x: number }[] = [];
  private readonly fills: { pane: PaneNode; left: PaneNode; right: PaneNode }[] = [];
  private readonly mask: PaneNode;
  private readonly pagePanes: PaneNode[] = [];
  private readonly backdrop = new Set<PaneNode>();
  private readonly plates: PaneNode[] = [];
  private readonly sheets: PaneNode[] = [];

  constructor(private readonly top: LayoutInstance) {
    const template = top.pane('N_Ch_c01').source;
    for (const [page, columns] of FAR_SLOTS) {
      const parent = top.pane(`N_Ch_${page}`);
      for (const [x, slots] of columns) {
        slots.forEach((slot, row) => top.addPane(parent, {
          ...template,
          name: `N_Ch_${page}${String(slot).padStart(2, '0')}`,
          translate: [x, ROWS[row], 0],
          children: [],
        }));
      }
    }
    const all = top.pane('N_ChAll');
    for (const kind of BAR) {
      const pieces = [0, 1, 2, 3, 4]
        .map((i) => top.pane(`${kind}${i}`))
        .sort((a, b) => a.translate[0] - b.translate[0]);
      for (const pane of pieces) this.bar.push({ pane, x: pane.translate[0] });
      // Fillers draw right after the last piece of their kind, so the bar keeps its layering.
      let after = top.pane(`${kind}0`);
      for (let i = 0; i + 1 < pieces.length; i++) {
        after = top.addPane(all, this.flatPiece(pieces[i], `${kind}Fill${i}`), after);
        this.fills.push({ pane: after, left: pieces[i], right: pieces[i + 1] });
      }
    }
    this.mask = top.pane('ChMask');
    for (const [name, pane] of top.panes) {
      if (PAGE_ONLY.test(name)) this.pagePanes.push(pane);
      if (PAGE_BACKDROP.test(name)) this.backdrop.add(pane);
      if (PLATE.test(name)) this.plates.push(pane);
      if (PLATE.test(name) || BAND.test(name)) this.sheets.push(pane);
    }
  }

  /** A hidden copy of a bar piece whose textures all read their flat first column. */
  private flatPiece(piece: PaneNode, name: string): Pane {
    const state = this.top.materials[piece.source.picture!.material];
    const flat: MaterialState = {
      ...state,
      texSRTs: state.texSRTs.map((srt) => ({
        translate: [-0.5, srt.translate[1]],
        rotate: srt.rotate,
        scale: [0, srt.scale[1]],
      })),
    };
    this.top.materials.push(flat);
    return {
      ...piece.source,
      name,
      flags: piece.source.flags & ~1,
      translate: [...piece.source.translate],
      size: [...piece.source.size],
      children: [],
      picture: { ...piece.source.picture!, material: this.top.materials.length - 1 },
    };
  }

  /** Before the layout's update: places the bar pieces, their fillers and the dimmer for this window. */
  place(screen: Screen): void {
    const spread = screen.width / screen.projection;
    const slide = this.top.pane('N_ChAll').translate[0];
    for (const { pane, x } of this.bar) pane.translate[0] = spread === 1 ? x : spread * (x + slide) - slide;
    for (const fill of this.fills) {
      const from = fill.left.translate[0] + fill.left.size[0] / 2;
      const to = fill.right.translate[0] - fill.right.size[0] / 2;
      fill.pane.visible = to > from;
      fill.pane.translate[0] = (from + to) / 2;
      fill.pane.size[0] = to - from;
    }
    cover(this.mask, screen);
  }

  /**
   * Draws the pages; contained, they slide within half a page of the middle over a backdrop that rests, while the
   * bar runs on. A curve sliding past the picture's edge carries the bar beside it along, so it never breaks.
   */
  draw(renderer: Renderer, screen: Screen, drawPages: () => void): void {
    const contained = screen.contained;
    const half = (this.top.pane('N_Ch_d').world[3] - this.top.pane('N_Ch_c').world[3]) / 2;
    const window: Rect | null = contained && [-half, contained[1], half, contained[3]];
    const fade = contained && (16 / 9) * (screen.window / screen.projection) >= FADE_FROM;
    const strips = fade ? this.strips(contained, half) : [];
    if (contained) {
      // Contained, the backdrop rests while the pages slide: each page's is lit in its middle, and that light moving
      // against the still sides would show.
      const all = this.top.pane('N_ChAll');
      const slide = all.translate[0];
      all.translate[0] = 0;
      this.top.update(identity(), screen.tv);
      const restX = this.sheets.map((sheet) => sheet.world[3]);
      for (const pane of [...this.backdrop, ...this.plates]) pane.bounds = null;
      renderer.within(contained, () => this.drawBackdrop(renderer));
      drawWings(renderer, screen, this.top, (pane) => !PAGE_ONLY.test(pane.name) && !this.isBar(pane));
      all.translate[0] = slide;
      this.top.update(identity(), screen.tv);
      this.holdSheets(restX);
      if (fade) renderer.keep(strips);
    }
    // Contained, the pages stay within half a page of the middle, so no sliver of the next shows, or fade out past it.
    for (const pane of [...this.pagePanes, ...this.plates]) pane.bounds = fade ? contained : window;
    for (const pane of this.backdrop) pane.bounds = contained && DRAWN;
    renderer.within(contained, drawPages);
    this.releaseSheets();
    if (fade) this.fadeStrips(renderer, strips);
    if (contained) drawWings(renderer, screen, this.top, (pane) => this.isBar(pane));
  }

  /** Between the pages' window and the picture's edges, as high as the page frames reach (the band and bar stay live). */
  private strips(contained: Rect, half: number): [Rect, Rect] {
    const frame = this.top.pane('Edge2');
    const m = frame.world;
    const top = m[7] + m[5] * (Math.floor(frame.source.origin / 3) / 2) * frame.size[1];
    const bottom = top - m[5] * frame.size[1];
    return [[contained[0], top, -half, bottom], [half, top, contained[2], bottom]];
  }

  /** Lays the kept backdrop back over the strips: clear at the pages' window, opaque once the fade has run. */
  private fadeStrips(renderer: Renderer, [left, right]: Rect[]): void {
    const [outerLeft, top, innerLeft, bottom] = left;
    const [innerRight, , outerRight] = right;
    const fadeLeft = innerLeft + (outerLeft - innerLeft) * FADE_SHARE;
    const fadeRight = innerRight + (outerRight - innerRight) * FADE_SHARE;
    renderer.fadeBack([outerLeft, top, fadeLeft, bottom], 1, 1);
    renderer.fadeBack([fadeLeft, top, innerLeft, bottom], 1, 0);
    renderer.fadeBack([innerRight, top, fadeRight, bottom], 0, 1);
    renderer.fadeBack([fadeRight, top, outerRight, bottom], 1, 1);
  }

  private readonly held: { srt: { translate: [number, number] }; u: number; map: { wrapS: number }; wrapS: number }[] = [];

  /** Offsets the sheet in the plates and bands against the slide: their holes and edges travel, the stripes and light rest. */
  private holdSheets(restX: number[]): void {
    const done = new Set<MaterialState>();
    this.sheets.forEach((pane, i) => {
      const state = this.top.materials[pane.source.picture!.material];
      if (done.has(state)) return;
      done.add(state);
      const sheet = state.textures.findIndex((name) => name?.startsWith('my_TVSheet'));
      // A material without TEV stages draws its first texture through its first coordinates.
      const stage = state.source.tevStages.find((s) => s.texMap === sheet);
      const gen = state.source.texCoordGens[stage ? stage.texCoord : 0];
      const srt = gen && gen.matrix >= 30 && gen.matrix < 60 ? state.texSRTs[(gen.matrix - 30) / 3] : undefined;
      const coords = gen && (pane.texCoords ?? pane.source.picture!.texCoords)[gen.source - 4];
      const map = state.source.texMaps[sheet];
      if (!srt || !coords || !map) return;
      const perUnit = (coords[1][0] - coords[0][0]) / (pane.size[0] * pane.world[0]);
      this.held.push({ srt, u: srt.translate[0], map, wrapS: map.wrapS });
      srt.translate[0] += srt.scale[0] * (pane.world[3] - restX[i]) * perUnit;
      // The sheet repeats page after page, so held still it reads on past its own page as the next one's.
      map.wrapS = GX_REPEAT;
    });
  }

  private releaseSheets(): void {
    for (const { srt, u, map, wrapS } of this.held) {
      srt.translate[0] = u;
      map.wrapS = wrapS;
    }
    this.held.length = 0;
  }

  private isBar(pane: PaneNode): boolean {
    return this.bar.some((piece) => piece.pane === pane);
  }

  /** The pages' backdrop in the grid's two passes: the masks first, then the pictures. */
  private drawBackdrop(renderer: Renderer): void {
    const mask = (pane: PaneNode) => pane.name.startsWith('BaseMask');
    renderer.drawLayout(this.top, (pane) => this.backdrop.has(pane) && mask(pane));
    renderer.drawLayout(this.top, (pane) => this.backdrop.has(pane) && !mask(pane));
  }
}
