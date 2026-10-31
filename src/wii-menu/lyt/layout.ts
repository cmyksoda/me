import type { RGBA } from './binary';
import type { Animation, Track } from './brlan';
import { sampleTrack } from './brlan';
import type { Layout, Material, Pane, Quad, TexSRT, Vec2 } from './brlyt';
import type { Rect } from './renderer';

/** Row-major 3x4 affine matrix, as NW4R's MTX34. */
export type Mtx34 = Float32Array;

const DEG = Math.PI / 180;

export function identity(): Mtx34 {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
}

export function multiply(a: Mtx34, b: Mtx34, out: Mtx34 = new Float32Array(12)): Mtx34 {
  for (let row = 0; row < 3; row++) {
    const r = row * 4;
    for (let col = 0; col < 4; col++) {
      out[r + col] = a[r] * b[col] + a[r + 1] * b[4 + col] + a[r + 2] * b[8 + col] + (col === 3 ? a[r + 3] : 0);
    }
  }
  return out;
}

export function transformPoint(m: Mtx34, x: number, y: number): [number, number] {
  return [m[0] * x + m[1] * y + m[3], m[4] * x + m[5] * y + m[7]];
}

/** Pane::CalculateMtx: T * Rz * Ry * Rx * S. */
function paneMatrix(pane: PaneNode, x: number, scaleX: number, out: Mtx34): void {
  const [rx, ry, rz] = pane.rotate;
  const cx = Math.cos(rx * DEG), sx = Math.sin(rx * DEG);
  const cy = Math.cos(ry * DEG), sy = Math.sin(ry * DEG);
  const cz = Math.cos(rz * DEG), sz = Math.sin(rz * DEG);
  const scaleY = pane.scale[1];
  out[0] = cz * cy * scaleX;
  out[1] = (cz * sy * sx - sz * cx) * scaleY;
  out[2] = cz * sy * cx + sz * sx;
  out[3] = x;
  out[4] = sz * cy * scaleX;
  out[5] = (sz * sy * sx + cz * cx) * scaleY;
  out[6] = sz * sy * cx - cz * sx;
  out[7] = pane.translate[1];
  out[8] = -sy * scaleX;
  out[9] = cy * sx * scaleY;
  out[10] = cy * cx;
  out[11] = pane.translate[2];
}

export interface PaneNode {
  source: Pane;
  name: string;
  parent: PaneNode | null;
  children: PaneNode[];
  visible: boolean;
  /** 0..255, animated through RLVC target 16. */
  alpha: number;
  translate: [number, number, number];
  rotate: [number, number, number];
  scale: Vec2;
  size: Vec2;
  vertexColors: Quad<RGBA> | null;
  /** Filled by LayoutInstance.update: world matrix and inherited alpha (0..1). */
  world: Mtx34;
  globalAlpha: number;
  /** Replaces a text box's string, as the menu does for names, dates and labels. */
  text?: string;
  /** Recolors stretches of the text, as a tag processor's SetTextColor does (`lift` raises them). */
  textRuns?: { from: number; to: number; color: RGBA; lift: number }[];
  /** Replaces a picture's texture coordinates, as Picture::SetTexCoord does. */
  texCoords?: Quad<Vec2>[];
  /** Lets a scene draw something of its own (a channel icon, say) in this pane's place. */
  onDraw?: (pane: PaneNode) => void;
  /** Keeps this pane's own drawing, onDraw included, inside a rectangle. */
  bounds?: Rect | null;
}

export interface MaterialState {
  source: Material;
  tevColors: [RGBA, RGBA, RGBA];
  konstColors: Quad<RGBA>;
  materialColor: RGBA;
  texSRTs: TexSRT[];
  /** Texture name per texture map; texture-pattern animations swap these. */
  textures: string[];
}

export interface Display {
  /** Logical width that flagged panes spread to: 608 for 4:3, 832 for 16:9, more on a wider window. Height is always 456. */
  width: number;
  /** The console projection's width (608 to 832), the one layouts stretch their root to. */
  projection: number;
  /** IPL layouts stretch their root to the wide screen and un-stretch panes flagged for it. */
  adjustLocation: boolean;
}

const copyRGBA = (c: RGBA): RGBA => [c[0], c[1], c[2], c[3]];
const copySRT = (s: TexSRT): TexSRT => ({ translate: [...s.translate], rotate: s.rotate, scale: [...s.scale] });

/** A live copy of a parsed layout whose panes and materials animations can change. */
export class LayoutInstance {
  readonly root: PaneNode;
  readonly panes = new Map<string, PaneNode>();
  readonly materials: MaterialState[];
  private readonly scratch = identity();

  constructor(readonly layout: Layout, readonly files: Map<string, Uint8Array>) {
    this.materials = layout.materials.map((m) => ({
      source: m,
      tevColors: m.tevColors.map(copyRGBA) as [RGBA, RGBA, RGBA],
      konstColors: m.konstColors.map(copyRGBA) as Quad<RGBA>,
      materialColor: m.materialColor ? copyRGBA(m.materialColor) : [255, 255, 255, 255],
      texSRTs: m.texSRTs.map(copySRT),
      textures: m.texMaps.map((t) => layout.textures[t.texture]),
    }));
    this.root = this.build(layout.root, null);
  }

  private build(source: Pane, parent: PaneNode | null): PaneNode {
    const content = source.picture ?? source.window;
    const node: PaneNode = {
      source,
      name: source.name,
      parent,
      children: [],
      visible: (source.flags & 1) !== 0,
      alpha: source.alpha,
      translate: [...source.translate],
      rotate: [...source.rotate],
      scale: [...source.scale],
      size: [...source.size],
      vertexColors: content ? (content.vertexColors.map(copyRGBA) as Quad<RGBA>) : null,
      world: identity(),
      globalAlpha: 1,
    };
    if (!this.panes.has(node.name)) this.panes.set(node.name, node);
    node.children = source.children.map((child) => this.build(child, node));
    return node;
  }

  pane(name: string): PaneNode {
    const pane = this.panes.get(name);
    if (!pane) throw new Error(`No pane ${name}`);
    return pane;
  }

  /** Adds a pane the layout doesn't have under `parent`, right after `after` or after all its children. */
  addPane(parent: PaneNode, source: Pane, after?: PaneNode): PaneNode {
    const node = this.build(source, parent);
    parent.children.splice(after ? parent.children.indexOf(after) + 1 : parent.children.length, 0, node);
    return node;
  }

  material(name: string): MaterialState | undefined {
    return this.materials.find((m) => m.source.name === name);
  }

  /** Recomputes world matrices and alpha for every visible pane (Pane::CalculateMtx). */
  update(view: Mtx34, display: Display): void {
    const wideScale = display.projection / 608;
    // Past the projection, flagged panes keep their place relative to the window's edges.
    const spread = display.width / display.projection;
    // The menu sets SetInvisiblePaneCalculateMtx: hidden panes still get matrices, as anchors.
    const walk = (pane: PaneNode, parentWorld: Mtx34, inherited: number | null) => {
      let scaleX = pane.scale[0];
      let x = pane.translate[0];
      if (display.adjustLocation && display.projection !== 608) {
        if (pane.parent === null) scaleX *= wideScale;
        if (pane.source.flags & 4) scaleX /= wideScale;
      }
      if (display.adjustLocation && spread !== 1 && pane.source.flags & 4) x *= spread;
      paneMatrix(pane, x, scaleX, this.scratch);
      multiply(parentWorld, this.scratch, pane.world);
      const own = pane.alpha / 255;
      pane.globalAlpha = inherited === null ? own : own * inherited;
      // Children only feel this pane's alpha when it is flagged to pass it down.
      const passed = pane.source.flags & 2 && pane.alpha !== 255 ? (inherited ?? 1) * own : inherited;
      for (const child of pane.children) walk(child, pane.world, passed);
    };
    walk(this.root, view, null);
  }
}

function setColorComponent(color: RGBA, index: number, value: number, min = 0, max = 255): void {
  color[index] = Math.min(max, Math.max(min, value));
}

export interface PlaybackOptions {
  /** Only animate these panes (a layout group's members) and their materials. */
  panes?: Iterable<string>;
  /** Also animate the listed panes' descendants, as a recursive group binding does. */
  recursive?: boolean;
  /** Frame range to play; one file often holds several animations side by side. */
  from?: number;
  to?: number;
  /** Wrap at the end instead of stopping; the default is to play once. */
  loop?: boolean;
  /** Only bind targets with a key inside from–to, as binding the clip's own group would. */
  keyedOnly?: boolean;
  /** Sample whole frames only, as the console's updates do; banner tools draw jumps as one-frame slides. */
  wholeFrames?: boolean;
}

/**
 * Binds a BRLAN to a layout instance and plays it like the menu's Animator: a looping clip wraps
 * at its last frame, a one-shot clip runs to frameSize − 1 and holds its final pose. Files often
 * set the loop flag on clips the menu plays once, so looping is the caller's choice.
 */
export class AnimationPlayer {
  frame: number;
  playing = false;
  backward = false;
  readonly from: number;
  readonly to: number;
  readonly loop: boolean;
  private readonly wholeFrames: boolean;
  private readonly bindings: { track: Track; pane?: PaneNode; material?: MaterialState }[] = [];

  constructor(readonly animation: Animation, readonly instance: LayoutInstance, options: PlaybackOptions = {}) {
    this.loop = options.loop ?? false;
    this.wholeFrames = options.wholeFrames ?? false;
    this.from = options.from ?? 0;
    this.to = options.to ?? (this.loop ? animation.frameSize : animation.frameSize - 1);
    this.frame = this.from;
    const scope = options.panes ? this.scope(options.panes, options.recursive ?? false) : null;
    const keyed = (tracks: Track[]) => tracks.some((t) => t.keys.some((k) => k.frame >= this.from && k.frame <= this.to));
    for (const target of animation.targets) {
      // EqualsPaneName compares 16 characters, all a layout keeps, so longer clip targets still bind.
      const pane = target.isMaterial ? undefined : instance.panes.get(target.name.slice(0, 16));
      const material = target.isMaterial ? instance.material(target.name) : undefined;
      if (scope && !(pane ? scope.panes.has(pane) : material && scope.materials.has(material))) continue;
      if (options.keyedOnly && !keyed(target.tracks)) continue;
      if (!pane && !material) continue;
      for (const track of target.tracks) this.bindings.push({ track, pane, material });
    }
  }

  /** Starts from the first frame (or the last, backward); the first pose shown is one frame in. */
  play(backward = false): this {
    this.backward = backward;
    this.frame = backward ? this.to : this.from;
    this.playing = true;
    return this;
  }

  /** Shows the pose at one frame without playing, as the menu's initAnmFrame does. */
  seek(frame: number): this {
    this.frame = frame;
    this.playing = false;
    this.apply();
    return this;
  }

  /** Advances a playing clip by `frames` (60 per second) and applies its pose. */
  step(frames: number): void {
    if (!this.playing) return;
    this.frame += this.backward ? -frames : frames;
    const length = this.to - this.from;
    if (this.loop && length > 0) {
      while (this.frame >= this.to) this.frame -= length;
      while (this.frame < this.from) this.frame += length;
    } else if (!this.backward && this.frame >= this.to) {
      this.frame = this.to;
      this.playing = false;
    } else if (this.backward && this.frame <= this.from) {
      this.frame = this.from;
      this.playing = false;
    }
    this.apply();
  }

  apply(): void {
    const frame = this.wholeFrames ? Math.floor(this.frame) : this.frame;
    for (const { track, pane, material } of this.bindings) {
      const value = sampleTrack(track, frame);
      if (pane) applyPaneTrack(pane, track, value);
      else if (material) applyMaterialTrack(material, track, value, this.animation.textures);
    }
  }

  private scope(names: Iterable<string>, recursive: boolean) {
    const panes = new Set<PaneNode>();
    const add = (pane: PaneNode) => {
      panes.add(pane);
      if (recursive) pane.children.forEach(add);
    };
    for (const name of names) {
      const pane = this.instance.panes.get(name);
      if (pane) add(pane);
    }
    const materials = new Set<MaterialState>();
    for (const pane of panes) {
      const content = pane.source.picture ?? pane.source.window ?? pane.source.text;
      if (content) materials.add(this.instance.materials[content.material]);
    }
    return { panes, materials };
  }
}

function applyPaneTrack(pane: PaneNode, track: Track, value: number): void {
  switch (track.kind) {
    case 'RLPA': {
      const t = track.target;
      if (t < 3) pane.translate[t] = value;
      else if (t < 6) pane.rotate[t - 3] = value;
      else if (t < 8) pane.scale[t - 6] = value;
      else pane.size[t - 8] = value;
      break;
    }
    case 'RLVI':
      pane.visible = value !== 0;
      break;
    case 'RLVC': {
      // AnimateVertexColor rounds to u8 the way OSf32tou8 does.
      const byte = Math.min(255, Math.max(0, Math.floor(value + 0.5)));
      if (track.target === 16) pane.alpha = byte;
      else if (pane.vertexColors) pane.vertexColors[track.target >> 2][track.target & 3] = byte;
      break;
    }
  }
}

function applyMaterialTrack(material: MaterialState, track: Track, value: number, names: string[]): void {
  switch (track.kind) {
    case 'RLMC': {
      const t = track.target;
      const rounded = Math.floor(value + 0.5);
      if (t < 4) setColorComponent(material.materialColor, t, rounded);
      else if (t < 16) setColorComponent(material.tevColors[(t - 4) >> 2], t & 3, rounded, -1024, 1023);
      else setColorComponent(material.konstColors[(t - 16) >> 2], t & 3, rounded);
      break;
    }
    case 'RLTS': {
      const srt = material.texSRTs[track.index];
      if (!srt) break;
      const t = track.target;
      if (t < 2) srt.translate[t] = value;
      else if (t === 2) srt.rotate = value;
      else srt.scale[t - 3] = value;
      break;
    }
    case 'RLTP':
      if (track.index < material.textures.length && names[value]) material.textures[track.index] = names[value];
      break;
  }
}
