import { readRGBA, Reader, sections, type RGBA } from './binary';

export type Vec2 = [number, number];
export type Quad<T> = [T, T, T, T];

export interface TexMap {
  texture: number;
  wrapS: number;
  wrapT: number;
}

export interface TexSRT {
  translate: Vec2;
  rotate: number;
  scale: Vec2;
}

export interface TexCoordGen {
  type: number;
  source: number;
  matrix: number;
}

export interface TevOp {
  a: number;
  b: number;
  c: number;
  d: number;
  op: number;
  bias: number;
  scale: number;
  clamp: boolean;
  dest: number;
}

/** The indirect-texture order a TEV stage names (GXSetIndTexOrder and GXSetIndTexCoordScale). */
export interface IndirectOrder {
  texCoord: number;
  texMap: number;
  /** GXIndTexScale: the lookup coordinate is divided by 2^n. */
  scaleS: number;
  scaleT: number;
}

/** A TEV stage's GXSetTevIndirect settings, with the order it points at. */
export interface TevIndirect {
  order: IndirectOrder;
  /** GXIndTexFormat: 0 ITF_8, 1 ITF_5, 2 ITF_4, 3 ITF_3. */
  format: number;
  /** GXIndTexBiasSel bits: 1 S, 2 T, 4 U. */
  bias: number;
  /** GXIndTexMtxID: 1 to 3 pick indirect SRT 0 to 2, 0 is off. */
  matrix: number;
  /** GXIndTexWrap: 0 off, 1 to 5 are 256 down to 16, 6 zero. */
  wrapS: number;
  wrapT: number;
  addPrevious: boolean;
}

export interface TevStage {
  texCoord: number;
  channel: number;
  texMap: number;
  rasSwap: number;
  texSwap: number;
  color: TevOp;
  alpha: TevOp;
  konstColor: number;
  konstAlpha: number;
  /** Null when the stage leaves its texture coordinate alone. */
  indirect: TevIndirect | null;
  /** The original 16 bytes, used as part of the shader cache key. */
  key: string;
}

export interface AlphaCompare {
  comp0: number;
  ref0: number;
  op: number;
  comp1: number;
  ref1: number;
}

export interface BlendMode {
  type: number;
  src: number;
  dst: number;
  logic: number;
}

export interface Material {
  name: string;
  /** TEV color registers C0..C2 as signed 10-bit components. */
  tevColors: [RGBA, RGBA, RGBA];
  konstColors: Quad<RGBA>;
  texMaps: TexMap[];
  texSRTs: TexSRT[];
  texCoordGens: TexCoordGen[];
  /** GX color/alpha source for COLOR0A0: 0 register (material color), 1 vertex. */
  colorSource: number;
  alphaSource: number;
  hasChanCtrl: boolean;
  materialColor: RGBA | null;
  /** Four swap tables, each [r, g, b, a] channel selectors, or null for GX defaults. */
  swapTables: Quad<Quad<number>> | null;
  indSRTs: TexSRT[];
  tevStages: TevStage[];
  alphaCompare: AlphaCompare | null;
  blendMode: BlendMode | null;
}

export type PaneKind = 'pan1' | 'pic1' | 'txt1' | 'wnd1' | 'bnd1';

export interface Pane {
  kind: PaneKind;
  name: string;
  /** Bit 0 visible, bit 1 children inherit alpha, bit 2 location adjust (16:9). */
  flags: number;
  /** 0..8: (vertical row) * 3 + horizontal column, top-left first. */
  origin: number;
  alpha: number;
  translate: [number, number, number];
  rotate: [number, number, number];
  scale: Vec2;
  size: Vec2;
  children: Pane[];
  picture?: PictureContent;
  text?: TextContent;
  window?: WindowContent;
}

export interface PictureContent {
  vertexColors: Quad<RGBA>;
  material: number;
  /** Per texture coordinate set, the four corners TL, TR, BL, BR. */
  texCoords: Quad<Vec2>[];
}

export interface TextContent {
  material: number;
  font: number;
  /** Where the text block sits inside the pane, same encoding as pane origin. */
  position: number;
  /** 0 follows position, then left, center, right. */
  alignment: number;
  text: string;
  colors: [RGBA, RGBA];
  fontSize: Vec2;
  charSpace: number;
  lineSpace: number;
}

export interface WindowFrame {
  material: number;
  flip: number;
}

export interface WindowContent extends PictureContent {
  inflation: [number, number, number, number];
  frames: WindowFrame[];
}

export interface Layout {
  width: number;
  height: number;
  textures: string[];
  fonts: string[];
  materials: Material[];
  root: Pane;
  groups: Map<string, string[]>;
}

function readSRT(r: Reader, at: number): TexSRT {
  return { translate: [r.f32(at), r.f32(at + 4)], rotate: r.f32(at + 8), scale: [r.f32(at + 12), r.f32(at + 16)] };
}

function readTevOp(r: Reader, at: number): TevOp {
  const ab = r.u8(at), cd = r.u8(at + 1), op = r.u8(at + 2), out = r.u8(at + 3);
  return {
    a: ab & 15, b: ab >> 4, c: cd & 15, d: cd >> 4,
    op: op & 15, bias: (op >> 4) & 3, scale: op >> 6,
    clamp: (out & 1) === 1, dest: (out >> 1) & 3,
  };
}

function readIndirect(r: Reader, at: number, orders: IndirectOrder[]): TevIndirect | null {
  const order = orders[r.u8(at)];
  const indirect = {
    order,
    bias: r.u8(at + 1) & 7,
    matrix: (r.u8(at + 1) >> 3) & 15,
    wrapS: r.u8(at + 2) & 7,
    wrapT: (r.u8(at + 2) >> 3) & 7,
    format: r.u8(at + 3) & 3,
    addPrevious: (r.u8(at + 3) & 4) !== 0,
  };
  // A stage whose matrix, wraps and add-previous are all off leaves its coordinate alone.
  const active = indirect.matrix || indirect.wrapS || indirect.wrapT || indirect.addPrevious;
  return order && active ? indirect : null;
}

function readMaterial(r: Reader, at: number): Material {
  const tevColors = [0, 1, 2].map((i) => {
    const c = at + 20 + i * 8;
    return [r.s16(c), r.s16(c + 2), r.s16(c + 4), r.s16(c + 6)] as RGBA;
  }) as [RGBA, RGBA, RGBA];
  const konstColors = [0, 1, 2, 3].map((i) => readRGBA(r, at + 44 + i * 4)) as Quad<RGBA>;
  const flags = r.u32(at + 60);
  let p = at + 64;

  const texMaps: TexMap[] = [];
  for (let i = 0; i < (flags & 15); i++, p += 4) {
    texMaps.push({ texture: r.u16(p), wrapS: r.u8(p + 2) & 3, wrapT: r.u8(p + 3) & 3 });
  }
  const texSRTs: TexSRT[] = [];
  for (let i = 0; i < ((flags >> 4) & 15); i++, p += 20) texSRTs.push(readSRT(r, p));
  const texCoordGens: TexCoordGen[] = [];
  for (let i = 0; i < ((flags >> 8) & 15); i++, p += 4) {
    texCoordGens.push({ type: r.u8(p), source: r.u8(p + 1), matrix: r.u8(p + 2) });
  }

  const hasChanCtrl = (flags & (1 << 25)) !== 0;
  let colorSource = 1, alphaSource = 1;
  if (hasChanCtrl) {
    colorSource = r.u8(p);
    alphaSource = r.u8(p + 1);
    p += 4;
  }
  let materialColor: RGBA | null = null;
  if (flags & (1 << 27)) {
    materialColor = readRGBA(r, p);
    p += 4;
  }
  let swapTables: Quad<Quad<number>> | null = null;
  if (flags & (1 << 12)) {
    swapTables = [0, 1, 2, 3].map((i) => {
      const v = r.u8(p + i);
      return [v & 3, (v >> 2) & 3, (v >> 4) & 3, (v >> 6) & 3];
    }) as Quad<Quad<number>>;
    p += 4;
  }
  const indSRTs: TexSRT[] = [];
  for (let i = 0; i < ((flags >> 13) & 3); i++, p += 20) indSRTs.push(readSRT(r, p));
  const indirectOrders: IndirectOrder[] = [];
  for (let i = 0; i < ((flags >> 15) & 7); i++, p += 4) {
    indirectOrders.push({ texCoord: r.u8(p), texMap: r.u8(p + 1), scaleS: r.u8(p + 2), scaleT: r.u8(p + 3) });
  }

  const tevStages: TevStage[] = [];
  for (let i = 0; i < ((flags >> 18) & 31); i++, p += 16) {
    const swap = r.u8(p + 3);
    tevStages.push({
      texCoord: r.u8(p),
      channel: r.u8(p + 1),
      texMap: ((swap & 1) << 8) | r.u8(p + 2),
      rasSwap: (swap >> 1) & 3,
      texSwap: (swap >> 3) & 3,
      color: readTevOp(r, p + 4),
      alpha: readTevOp(r, p + 8),
      konstColor: r.u8(p + 7) >> 3,
      konstAlpha: r.u8(p + 11) >> 3,
      indirect: readIndirect(r, p + 12, indirectOrders),
      key: Array.from(r.slice(p, 16)).join('.'),
    });
  }

  let alphaCompare: AlphaCompare | null = null;
  if (flags & (1 << 23)) {
    const comps = r.u8(p);
    alphaCompare = { comp0: comps & 15, comp1: comps >> 4, op: r.u8(p + 1), ref0: r.u8(p + 2), ref1: r.u8(p + 3) };
    p += 4;
  }
  let blendMode: BlendMode | null = null;
  if (flags & (1 << 24)) {
    blendMode = { type: r.u8(p), src: r.u8(p + 1), dst: r.u8(p + 2), logic: r.u8(p + 3) };
    p += 4;
  }

  return {
    name: r.string(at, 20), tevColors, konstColors, texMaps, texSRTs, texCoordGens, colorSource,
    alphaSource, hasChanCtrl, materialColor, swapTables, indSRTs, tevStages, alphaCompare, blendMode,
  };
}

function readPictureContent(r: Reader, at: number): PictureContent {
  const vertexColors = [0, 1, 2, 3].map((i) => readRGBA(r, at + i * 4)) as Quad<RGBA>;
  const texCoords: Quad<Vec2>[] = [];
  for (let i = 0; i < r.u8(at + 18); i++) {
    const c = at + 20 + i * 32;
    texCoords.push([0, 1, 2, 3].map((j) => [r.f32(c + j * 8), r.f32(c + j * 8 + 4)]) as Quad<Vec2>);
  }
  return { vertexColors, material: r.u16(at + 16), texCoords };
}

function readStringTable(r: Reader, at: number): string[] {
  const names: string[] = [];
  const table = at + 12;
  for (let i = 0; i < r.u16(at + 8); i++) names.push(r.string(table + r.u32(table + i * 8)));
  return names;
}

export function parseBRLYT(bytes: Uint8Array): Layout {
  const r = new Reader(bytes);
  const layout: Layout = {
    width: 0, height: 0, textures: [], fonts: [], materials: [], groups: new Map(),
    root: null as unknown as Pane,
  };
  const parents: Pane[] = [];
  let last: Pane | null = null;

  for (const [kind, at] of sections(r, 'RLYT')) {
    switch (kind) {
      case 'lyt1':
        layout.width = r.f32(at + 12);
        layout.height = r.f32(at + 16);
        break;
      case 'txl1':
        layout.textures = readStringTable(r, at);
        break;
      case 'fnl1':
        layout.fonts = readStringTable(r, at);
        break;
      case 'mat1':
        for (let i = 0; i < r.u16(at + 8); i++) layout.materials.push(readMaterial(r, at + r.u32(at + 12 + i * 4)));
        break;
      case 'pan1':
      case 'pic1':
      case 'txt1':
      case 'wnd1':
      case 'bnd1': {
        const pane: Pane = {
          kind,
          name: r.string(at + 12, 16),
          flags: r.u8(at + 8),
          origin: r.u8(at + 9),
          alpha: r.u8(at + 10),
          translate: [r.f32(at + 36), r.f32(at + 40), r.f32(at + 44)],
          rotate: [r.f32(at + 48), r.f32(at + 52), r.f32(at + 56)],
          scale: [r.f32(at + 60), r.f32(at + 64)],
          size: [r.f32(at + 68), r.f32(at + 72)],
          children: [],
        };
        if (kind === 'pic1') {
          pane.picture = readPictureContent(r, at + 76);
        } else if (kind === 'txt1') {
          const length = r.u16(at + 78);
          const textAt = at + r.u32(at + 88);
          let text = '';
          for (let i = 0; i + 1 < length; i += 2) {
            const code = r.u16(textAt + i);
            if (code === 0) break;
            text += String.fromCharCode(code);
          }
          pane.text = {
            material: r.u16(at + 80), font: r.u16(at + 82), position: r.u8(at + 84),
            alignment: r.u8(at + 85), text, colors: [readRGBA(r, at + 92), readRGBA(r, at + 96)],
            fontSize: [r.f32(at + 100), r.f32(at + 104)], charSpace: r.f32(at + 108),
            lineSpace: r.f32(at + 112),
          };
        } else if (kind === 'wnd1') {
          const frames: WindowFrame[] = [];
          const frameTable = at + r.u32(at + 100);
          for (let i = 0; i < r.u8(at + 92); i++) {
            const frame = at + r.u32(frameTable + i * 4);
            frames.push({ material: r.u16(frame), flip: r.u8(frame + 2) });
          }
          pane.window = {
            ...readPictureContent(r, at + r.u32(at + 96)),
            inflation: [r.f32(at + 76), r.f32(at + 80), r.f32(at + 84), r.f32(at + 88)],
            frames,
          };
        }
        if (parents.length) parents[parents.length - 1].children.push(pane);
        else layout.root = pane;
        last = pane;
        break;
      }
      case 'pas1':
        if (last) parents.push(last);
        break;
      case 'pae1':
        last = parents.pop() ?? null;
        break;
      case 'grp1': {
        const name = r.string(at + 8, 16);
        const panes: string[] = [];
        for (let i = 0; i < r.u16(at + 24); i++) panes.push(r.string(at + 28 + i * 16, 16));
        layout.groups.set(name, panes);
        break;
      }
    }
  }
  return layout;
}
