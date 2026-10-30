import type { Pane } from './lyt/brlyt';
import type { Display, LayoutInstance, MaterialState, PaneNode } from './lyt/layout';

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
export function cover(pane: PaneNode, screen: Display): void {
  const width = pane.source.size[0];
  pane.size[0] = screen.width > screen.projection ? Math.max(width, (608 * screen.width) / screen.projection) : width;
}

/** Spreads side-by-side full-screen pages with a window wider than the projection, each widened to meet the next. */
export function spreadPages(instance: LayoutInstance, names: string[], screen: Display): void {
  const spread = screen.width / screen.projection;
  for (const name of names) {
    const { source, translate, size } = instance.pane(name);
    translate[0] = spread === 1 ? source.translate[0] : spread * source.translate[0];
    size[0] = spread === 1 ? source.size[0] : spread * source.size[0];
  }
}

const BAR = ['Shade', 'board', 'Line'];
// The far pages' slots the grid layouts leave out: x of each missing column, and the slot numbers per row.
const FAR_SLOTS: [string, [number, number[]][]][] = [
  ['a', [[-192, [1, 5, 9]], [-64, [2, 6, 10]], [64, [3, 7, 11]]]],
  ['e', [[-64, [2, 6, 10]], [64, [3, 7, 11]], [192, [4, 8, 12]]]],
];
const ROWS = [175, 79, -17];

/**
 * What a channel grid layout (my_IplTop_a, mn_SdcardMenu_a) needs past 16:9: slots for more of the far
 * pages' tiles, a bottom bar whose page curves spread with the window like the pods, with flat bar
 * between them, and a zoom dimmer as wide as the window.
 */
export class WideGrid {
  private readonly bar: { pane: PaneNode; x: number }[] = [];
  private readonly fills: { pane: PaneNode; left: PaneNode; right: PaneNode }[] = [];
  private readonly mask: PaneNode;

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
      const pieces = [0, 1, 2, 3, 4].map((i) => top.pane(`${kind}${i}`)).sort((a, b) => a.translate[0] - b.translate[0]);
      for (const pane of pieces) this.bar.push({ pane, x: pane.translate[0] });
      // Fillers draw right after the last piece of their kind, so the bar keeps its layering.
      let after = top.pane(`${kind}0`);
      for (let i = 0; i + 1 < pieces.length; i++) {
        after = top.addPane(all, this.flatPiece(pieces[i], `${kind}Fill${i}`), after);
        this.fills.push({ pane: after, left: pieces[i], right: pieces[i + 1] });
      }
    }
    this.mask = top.pane('ChMask');
  }

  /** A hidden copy of a bar piece whose textures all read their flat first column. */
  private flatPiece(piece: PaneNode, name: string): Pane {
    const state = this.top.materials[piece.source.picture!.material];
    const flat: MaterialState = {
      ...state,
      texSRTs: state.texSRTs.map((srt) => ({ translate: [-0.5, srt.translate[1]], rotate: srt.rotate, scale: [0, srt.scale[1]] })),
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
  place(screen: Display): void {
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
}
