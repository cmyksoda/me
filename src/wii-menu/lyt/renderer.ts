import type { RGBA } from './binary';
import type { Quad, Vec2 } from './brlyt';
import { layoutText, type FontMetrics } from './font';
import type { LayoutInstance, MaterialState, Mtx34, PaneNode } from './layout';
import { materialShader, textShader, type ShaderSource } from './tev';
import { parseTPL } from './tpl';

const FLOATS_PER_VERTEX = 22;
const ATTRIBUTES = ['aPosition', 'aRaster', ...Array.from({ length: 8 }, (_, i) => `aTexCoord${i}`)];
const WHITE: RGBA = [255, 255, 255, 255];
const UNIT_UV: Quad<Vec2> = [[0, 0], [1, 0], [0, 1], [1, 1]];

interface Program {
  program: WebGLProgram;
  uniform: (name: string) => WebGLUniformLocation | null;
}

interface TextureEntry {
  texture: WebGLTexture;
  width: number;
  height: number;
  minFilter: number;
  magFilter: number;
}

export interface Camera {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
}

export type Rect = [left: number, top: number, right: number, bottom: number];

export interface LoadedFont {
  metrics: FontMetrics;
  texture: WebGLTexture;
  /** I4/I8 fonts carry coverage in every channel; IA fonts also carry shading. */
  intensity: boolean;
}

/** A quad in pane-local space with y pointing down, the way lyt's DrawQuad receives it. */
interface LocalQuad {
  x: number;
  y: number;
  width: number;
  height: number;
  material: number;
  vertexColors: Quad<RGBA>;
  texCoords: Quad<Vec2>[];
}

// GX blend factors; values 2 and 3 mean the other side's color, as in GXSetBlendMode.
const SOURCE_FACTORS = ['ZERO', 'ONE', 'DST_COLOR', 'ONE_MINUS_DST_COLOR', 'SRC_ALPHA', 'ONE_MINUS_SRC_ALPHA',
  'DST_ALPHA', 'ONE_MINUS_DST_ALPHA'] as const;
const DEST_FACTORS = ['ZERO', 'ONE', 'SRC_COLOR', 'ONE_MINUS_SRC_COLOR', 'SRC_ALPHA', 'ONE_MINUS_SRC_ALPHA',
  'DST_ALPHA', 'ONE_MINUS_DST_ALPHA'] as const;

const FILL_SHADER: ShaderSource = {
  key: 'fill',
  vertex: `#version 300 es
in vec2 aPosition;
in vec4 aRaster;
uniform vec2 uScreenHalf;
out vec4 vRaster;
void main() {
  gl_Position = vec4(aPosition / uScreenHalf, 0.0, 1.0);
  vRaster = aRaster;
}`,
  fragment: `#version 300 es
precision highp float;
in vec4 vRaster;
out vec4 fragColor;
void main() {
  fragColor = vRaster;
}`,
};

const CAPTURE_SHADER: ShaderSource = {
  key: 'capture',
  vertex: `#version 300 es
in vec2 aPosition;
in vec4 aRaster;
in vec2 aTexCoord0;
uniform vec2 uScreenHalf;
out vec4 vRaster;
out vec2 vTexCoord0;
void main() {
  gl_Position = vec4(aPosition / uScreenHalf, 0.0, 1.0);
  vRaster = aRaster;
  vTexCoord0 = aTexCoord0;
}`,
  fragment: `#version 300 es
precision highp float;
uniform sampler2D uTexture;
in vec4 vRaster;
in vec2 vTexCoord0;
out vec4 fragColor;
void main() {
  fragColor = vec4(texture(uTexture, vTexCoord0).rgb, vRaster.a);
}`,
};

/** Window frame corners (lyt_window.cpp): one corner's texels stay anchored, the rest stretch. */
const FRAME_FLIPS: [Quad<Vec2>, Vec2][] = [
  [[[0, 0], [1, 0], [0, 1], [1, 1]], [0, 1]],
  [[[1, 0], [0, 0], [1, 1], [0, 1]], [0, 1]],
  [[[0, 1], [1, 1], [0, 0], [1, 0]], [0, 1]],
  [[[0, 1], [0, 0], [1, 1], [1, 0]], [1, 0]],
  [[[1, 1], [0, 1], [1, 0], [0, 0]], [0, 1]],
  [[[1, 0], [1, 1], [0, 0], [0, 1]], [1, 0]],
];

function frameTexCoords(size: Vec2, textureSize: Vec2, flip: number, corner: number): Quad<Vec2> {
  const [coords, axes] = FRAME_FLIPS[flip];
  const result: Quad<Vec2> = [[0, 0], [0, 0], [0, 0], [0, 0]];
  for (let axis = 0; axis < 2; axis++) {
    const index = axes[axis];
    const bit = 1 << axis;
    const anchor = coords[corner][index];
    const opposite = anchor + size[axis] / ((coords[corner ^ bit][index] - anchor) * textureSize[index]);
    for (let vertex = 0; vertex < 4; vertex++) {
      result[vertex][index] = (vertex & bit) === (corner & bit) ? anchor : opposite;
    }
  }
  return result;
}

export class Renderer {
  readonly gl: WebGL2RenderingContext;
  readonly fonts = new Map<string, LoadedFont>();
  private readonly programs = new Map<string, Program>();
  private readonly samplers = new Map<string, WebGLSampler>();
  private readonly textures = new WeakMap<Map<string, Uint8Array>, Map<string, TextureEntry | null>>();
  private readonly buffer: WebGLBuffer;
  private vertices = new Float32Array(FLOATS_PER_VERTEX * 4);
  private screenHalf: Vec2 = [304, 228];
  private viewport: [number, number, number, number] = [0, 0, 1, 1];
  private target: { framebuffer: WebGLFramebuffer; texture: WebGLTexture; width: number; height: number } | null = null;
  private outerViewport: [number, number, number, number] | null = null;
  /** The zoom camera (setOrthoTransAndScale): screen = (world − center) × scale; null is the default camera. */
  camera: Camera | null = null;

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: true, premultipliedAlpha: false });
    if (!gl) throw new Error('This page needs WebGL 2.');
    this.gl = gl;
    this.buffer = gl.createBuffer()!;
    gl.bindVertexArray(gl.createVertexArray());
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    let offset = 0;
    [2, 4, 2, 2, 2, 2, 2, 2, 2, 2].forEach((size, location) => {
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, FLOATS_PER_VERTEX * 4, offset * 4);
      offset += size;
    });
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  }

  /** Starts a frame: `screen` is the logical TV area (608 or 832 by 456) drawn into `viewport` pixels. */
  beginFrame(screen: Vec2, viewport: [number, number, number, number]): void {
    const gl = this.gl;
    this.screenHalf = [screen[0] / 2, screen[1] / 2];
    this.viewport = viewport;
    gl.viewport(...viewport);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  /** Limits drawing to a logical-screen rectangle [left, top, right, bottom] (y up), or lifts the limit. */
  setClip(rect: Rect | null): void {
    const gl = this.gl;
    if (!rect) {
      gl.disable(gl.SCISSOR_TEST);
      return;
    }
    const [vx, vy, vw, vh] = this.viewport;
    const toX = (x: number) => vx + ((this.cameraX(x) / this.screenHalf[0] + 1) / 2) * vw;
    const toY = (y: number) => vy + ((this.cameraY(y) / this.screenHalf[1] + 1) / 2) * vh;
    const x0 = Math.round(toX(rect[0]));
    const y0 = Math.round(toY(rect[3]));
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(x0, y0, Math.max(0, Math.round(toX(rect[2])) - x0), Math.max(0, Math.round(toY(rect[1])) - y0));
  }

  /** Fills a logical-screen rectangle (y up) with a flat color, for faders and the zoom surround. */
  fill(rect: Rect, color: RGBA): void {
    this.drawRect(FILL_SHADER, rect, color, null);
  }

  /** Renders `draw` into an offscreen copy of the screen, as the preview's zoom capture does. */
  capture(draw: () => void): void {
    const gl = this.gl;
    const [, , width, height] = this.viewport;
    if (!this.target || this.target.width !== width || this.target.height !== height) {
      const texture = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      const framebuffer = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      this.target = { framebuffer, texture, width, height };
    }
    const outer = this.viewport;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.target.framebuffer);
    this.viewport = [0, 0, width, height];
    gl.viewport(0, 0, width, height);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const camera = this.camera;
    this.camera = null;
    draw();
    this.camera = camera;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.viewport = outer;
    gl.viewport(...outer);
  }

  /** Draws the last capture into a rectangle (through the camera) at the given opacity. */
  drawCapture(rect: Rect, alpha: number): void {
    if (this.target) this.drawRect(CAPTURE_SHADER, rect, [255, 255, 255, alpha * 255], this.target.texture);
  }

  private drawRect(shader: ShaderSource, rect: Rect, color: RGBA, texture: WebGLTexture | null): void {
    const gl = this.gl;
    const program = this.program(shader);
    gl.useProgram(program.program);
    const [left, top, right, bottom] = rect;
    const out = this.vertices;
    [[left, top, 0, 1], [right, top, 1, 1], [left, bottom, 0, 0], [right, bottom, 1, 0]].forEach(([x, y, u, v], i) => {
      const o = i * FLOATS_PER_VERTEX;
      out[o] = this.cameraX(x);
      out[o + 1] = this.cameraY(y);
      out.set(color.map((c) => c / 255), o + 2);
      out[o + 6] = u;
      out[o + 7] = v;
    });
    gl.uniform2f(program.uniform('uScreenHalf'), ...this.screenHalf);
    if (texture) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.bindSampler(0, this.sampler(0, 0, 1, 1));
      gl.uniform1i(program.uniform('uTexture'), 0);
    }
    this.setBlend(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, out.subarray(0, FLOATS_PER_VERTEX * 4), gl.STREAM_DRAW);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private cameraX(x: number): number {
    return this.camera ? (x - this.camera.x) * this.camera.scaleX : x;
  }

  private cameraY(y: number): number {
    return this.camera ? (y - this.camera.y) * this.camera.scaleY : y;
  }

  async loadFont(name: string, url: string): Promise<void> {
    const [metrics, image] = await Promise.all([
      fetch(`${url}.json`).then((r) => r.json() as Promise<FontMetrics>),
      fetch(`${url}.png`).then((r) => r.blob()).then((b) => createImageBitmap(b, {
        premultiplyAlpha: 'none',
        colorSpaceConversion: 'none',
      })),
    ]);
    const gl = this.gl;
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    this.fonts.set(name, { metrics, texture, intensity: name.endsWith('_I4') || name.endsWith('_I8') });
  }

  /** Draws every visible pane of a layout in tree order (Pane::Draw); `only` can skip some panes' own drawing. */
  drawLayout(instance: LayoutInstance, only?: (pane: PaneNode) => boolean): void {
    const walk = (pane: PaneNode) => {
      if (!pane.visible) return;
      if (!only || only(pane)) {
        this.drawPane(instance, pane);
        pane.onDraw?.(pane);
      }
      for (const child of pane.children) walk(child);
    };
    walk(instance.root);
  }

  private drawPane(instance: LayoutInstance, pane: PaneNode): void {
    const source = pane.source;
    const [width, height] = pane.size;
    const x = -((source.origin % 3) / 2) * width;
    const y = -(Math.floor(source.origin / 3) / 2) * height;
    if (source.picture) {
      this.drawQuad(instance, pane, {
        x, y, width, height,
        material: source.picture.material,
        vertexColors: pane.vertexColors!,
        texCoords: source.picture.texCoords,
      });
    } else if (source.window) {
      for (const quad of this.windowQuads(instance, pane, x, y)) this.drawQuad(instance, pane, quad);
    } else if (source.text) {
      this.drawText(instance, pane);
    }
  }

  private windowQuads(instance: LayoutInstance, pane: PaneNode, x: number, y: number): LocalQuad[] {
    const window = pane.source.window!;
    const [width, height] = pane.size;
    const frames = window.frames;
    const count = frames.length;
    const textureSize = (frame?: { material: number }) => {
      const entry = frame && this.texture(instance, instance.materials[frame.material], 0);
      return entry ? [entry.width, entry.height] : [0, 0];
    };
    let [l, t] = [0, 0];
    let [r, b] = [0, 0];
    if (count === 1 || count === 4 || count === 8) {
      [l, t] = textureSize(frames[0]);
      [r, b] = textureSize(frames[count === 1 ? 0 : 3]);
    }
    const [il, ir, it, ib] = window.inflation;
    const quads: LocalQuad[] = [{
      x: x + l - il,
      y: y + t - it,
      width: width - l - r + il + ir,
      height: height - t - b + it + ib,
      material: window.material,
      vertexColors: pane.vertexColors!,
      texCoords: window.texCoords,
    }];
    const add = (index: number, corner: number, qx: number, qy: number, qw: number, qh: number, flip?: number) => {
      const frame = frames[index];
      const size = textureSize(frame) as Vec2;
      if (!size[0] || !size[1]) return;
      quads.push({
        x: x + qx, y: y + qy, width: qw, height: qh,
        material: frame.material,
        vertexColors: [WHITE, WHITE, WHITE, WHITE],
        texCoords: [frameTexCoords([qw, qh], size, flip ?? frame.flip, corner)],
      });
    };
    if (count === 1 || count === 4) {
      const one = count === 1;
      add(0, 0, 0, 0, width - r, t, one ? 0 : undefined);
      add(one ? 0 : 1, 1, width - r, 0, r, height - b, one ? 1 : undefined);
      add(one ? 0 : 3, 3, l, height - b, width - l, b, one ? 4 : undefined);
      add(one ? 0 : 2, 2, 0, t, l, height - t, one ? 2 : undefined);
    } else if (count === 8) {
      add(0, 0, 0, 0, l, t);
      add(6, 0, l, 0, width - l - r, t);
      add(1, 1, width - r, 0, r, t);
      add(5, 1, width - r, t, r, height - t - b);
      add(3, 3, width - r, height - b, r, b);
      add(7, 3, l, height - b, width - l - r, b);
      add(2, 2, 0, height - b, l, b);
      add(4, 2, 0, t, l, height - t - b);
    }
    return quads;
  }

  private drawQuad(instance: LayoutInstance, pane: PaneNode, quad: LocalQuad): void {
    const state = instance.materials[quad.material];
    if (!state) return;
    const material = state.source;
    const gl = this.gl;
    const program = this.program(materialShader(material));
    gl.useProgram(program.program);

    const alpha = pane.globalAlpha;
    const fromMaterial = material.hasChanCtrl;
    const corners: Vec2[] = [[0, 0], [1, 0], [0, 1], [1, 1]];
    const out = this.vertices;
    corners.forEach(([cx, cy], v) => {
      const lx = quad.x + cx * quad.width;
      const ly = quad.y + cy * quad.height;
      const o = v * FLOATS_PER_VERTEX;
      this.project(pane.world, lx, ly, out, o);
      const vertex = quad.vertexColors[v];
      const rgb = fromMaterial && material.colorSource === 0 ? state.materialColor : vertex;
      const a = fromMaterial && material.alphaSource === 0 ? state.materialColor[3] : vertex[3];
      out[o + 2] = rgb[0] / 255;
      out[o + 3] = rgb[1] / 255;
      out[o + 4] = rgb[2] / 255;
      out[o + 5] = (a / 255) * alpha;
      for (let set = 0; set < 8; set++) {
        const uv = (quad.texCoords[set] ?? UNIT_UV)[v];
        out[o + 6 + set * 2] = uv[0];
        out[o + 7 + set * 2] = uv[1];
      }
    });

    this.setMaterialUniforms(program, instance, state);
    this.setBlend(material.blendMode);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, out.subarray(0, FLOATS_PER_VERTEX * 4), gl.STREAM_DRAW);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private drawText(instance: LayoutInstance, pane: PaneNode): void {
    const content = pane.source.text!;
    const fontName = instance.layout.fonts[content.font]?.replace(/\.brfn[ta]$/, '');
    const font = fontName ? this.fonts.get(fontName) : undefined;
    const state = instance.materials[content.material];
    const text = pane.text ?? content.text;
    if (!font || !state || !text) return;

    const clamp = (c: RGBA): RGBA => c.map((v) => Math.min(255, Math.max(0, v))) as RGBA;
    const low = clamp(state.tevColors[0]);
    const high = clamp(state.tevColors[1]);
    const mapped = low.some((v) => v !== 0) || high.some((v) => v !== 255);
    const program = this.program(textShader(mapped, font.intensity));
    const gl = this.gl;
    gl.useProgram(program.program);

    const quads = layoutText(font.metrics, content, text, pane.source.origin, pane.size);
    if (!quads.length) return;
    const [top, bottom] = content.colors;
    const alpha = pane.globalAlpha;
    const count = quads.length * 6;
    if (this.vertices.length < count * FLOATS_PER_VERTEX) this.vertices = new Float32Array(count * FLOATS_PER_VERTEX);
    const out = this.vertices;
    let v = 0;
    for (const q of quads) {
      // Two triangles per glyph: TL, TR, BL and TR, BR, BL; top vertices take the top color.
      for (const [lx, ly, u, w, color] of [
        [q.left, q.top, q.u0, q.v0, top], [q.right, q.top, q.u1, q.v0, top], [q.left, q.bottom, q.u0, q.v1, bottom],
        [q.right, q.top, q.u1, q.v0, top], [q.right, q.bottom, q.u1, q.v1, bottom], [q.left, q.bottom, q.u0, q.v1, bottom],
      ] as [number, number, number, number, RGBA][]) {
        const o = v++ * FLOATS_PER_VERTEX;
        this.project(pane.world, lx, ly, out, o);
        out[o + 2] = color[0] / 255;
        out[o + 3] = color[1] / 255;
        out[o + 4] = color[2] / 255;
        out[o + 5] = (color[3] / 255) * alpha;
        out[o + 6] = u;
        out[o + 7] = w;
      }
    }

    gl.uniform2f(program.uniform('uScreenHalf'), ...this.screenHalf);
    gl.uniform4fv(program.uniform('uColor'), [...low, ...high, 0, 0, 0, 0].map((c) => c / 255));
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, font.texture);
    gl.bindSampler(0, this.sampler(0, 0, 1, 1));
    gl.uniform1iv(program.uniform('uTexture'), [0]);
    this.setBlend(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, out.subarray(0, count * FLOATS_PER_VERTEX), gl.STREAM_DRAW);
    gl.drawArrays(gl.TRIANGLES, 0, count);
  }

  /** Pane-local (y down, as DrawQuad sees it) to logical screen space; LoadMtx flips y for y-up layouts. */
  private project(world: Mtx34, x: number, yDown: number, out: Float32Array, offset: number): void {
    const y = -yDown;
    out[offset] = this.cameraX(world[0] * x + world[1] * y + world[3]);
    out[offset + 1] = this.cameraY(world[4] * x + world[5] * y + world[7]);
  }

  private setMaterialUniforms(program: Program, instance: LayoutInstance, state: MaterialState): void {
    const gl = this.gl;
    const material = state.source;
    gl.uniform2f(program.uniform('uScreenHalf'), ...this.screenHalf);
    gl.uniform4fv(program.uniform('uColor'), state.tevColors.flat().map((c) => c / 255));
    gl.uniform4fv(program.uniform('uKonst'), state.konstColors.flat().map((c) => c / 255));

    const rowsS: number[] = [];
    const rowsT: number[] = [];
    material.texCoordGens.forEach((gen) => {
      const srt = gen.matrix >= 30 && gen.matrix < 60 ? state.texSRTs[(gen.matrix - 30) / 3] : undefined;
      if (!srt) {
        rowsS.push(1, 0, 0);
        rowsT.push(0, 1, 0);
        return;
      }
      // lyt CalcTextureMtx: scale and rotate about the texture's center, then translate.
      const cos = Math.cos(srt.rotate * Math.PI / 180);
      const sin = Math.sin(srt.rotate * Math.PI / 180);
      const [a0, a1] = [cos * srt.scale[0], -sin * srt.scale[1]];
      const [b0, b1] = [sin * srt.scale[0], cos * srt.scale[1]];
      rowsS.push(a0, a1, srt.translate[0] + 0.5 - 0.5 * a0 - 0.5 * a1);
      rowsT.push(b0, b1, srt.translate[1] + 0.5 - 0.5 * b0 - 0.5 * b1);
    });
    if (rowsS.length) {
      gl.uniform3fv(program.uniform('uTexRowS'), rowsS);
      gl.uniform3fv(program.uniform('uTexRowT'), rowsT);
    }

    const units: number[] = [];
    material.texMaps.forEach((map, unit) => {
      const entry = this.texture(instance, state, unit);
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, entry?.texture ?? null);
      gl.bindSampler(unit, this.sampler(map.wrapS, map.wrapT, entry?.minFilter ?? 1, entry?.magFilter ?? 1));
      units.push(unit);
    });
    const location = program.uniform('uTexture');
    if (location && units.length) gl.uniform1iv(location, units);
  }

  private setBlend(mode: { type: number; src: number; dst: number } | null): void {
    const gl = this.gl;
    const type = mode?.type ?? 1;
    if (type === 0 || type === 2) {
      gl.disable(gl.BLEND);
      return;
    }
    gl.enable(gl.BLEND);
    if (type === 3) {
      gl.blendEquation(gl.FUNC_REVERSE_SUBTRACT);
      gl.blendFunc(gl.ONE, gl.ONE);
      return;
    }
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFunc(gl[SOURCE_FACTORS[mode?.src ?? 4]], gl[DEST_FACTORS[mode?.dst ?? 5]]);
  }

  /** Decodes (once) the TPL a material's texture map names, from the layout's own archive. */
  texture(instance: LayoutInstance, state: MaterialState, unit: number): TextureEntry | null {
    const name = state.textures[unit];
    if (!name) return null;
    let cache = this.textures.get(instance.files);
    if (!cache) this.textures.set(instance.files, (cache = new Map()));
    if (cache.has(name)) return cache.get(name)!;
    const file = instance.files.get(`arc/timg/${name}`)
      ?? [...instance.files].find(([path]) => path.endsWith(`/${name}`))?.[1];
    let entry: TextureEntry | null = null;
    if (file) {
      const [image] = parseTPL(file);
      const gl = this.gl;
      const texture = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, image.width, image.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, image.rgba);
      entry = { texture, width: image.width, height: image.height, minFilter: image.minFilter, magFilter: image.magFilter };
    }
    cache.set(name, entry);
    return entry;
  }

  private sampler(wrapS: number, wrapT: number, minFilter: number, magFilter: number): WebGLSampler {
    const key = `${wrapS}.${wrapT}.${minFilter}.${magFilter}`;
    let sampler = this.samplers.get(key);
    if (sampler) return sampler;
    const gl = this.gl;
    const wraps = [gl.CLAMP_TO_EDGE, gl.REPEAT, gl.MIRRORED_REPEAT];
    sampler = gl.createSampler()!;
    gl.samplerParameteri(sampler, gl.TEXTURE_WRAP_S, wraps[wrapS] ?? gl.CLAMP_TO_EDGE);
    gl.samplerParameteri(sampler, gl.TEXTURE_WRAP_T, wraps[wrapT] ?? gl.CLAMP_TO_EDGE);
    // Mip levels are not uploaded, so GX's mip filters fall back to their base filter.
    gl.samplerParameteri(sampler, gl.TEXTURE_MIN_FILTER, minFilter % 2 ? gl.LINEAR : gl.NEAREST);
    gl.samplerParameteri(sampler, gl.TEXTURE_MAG_FILTER, magFilter ? gl.LINEAR : gl.NEAREST);
    this.samplers.set(key, sampler);
    return sampler;
  }

  private program(source: ShaderSource): Program {
    const cached = this.programs.get(source.key);
    if (cached) return cached;
    const gl = this.gl;
    const compile = (type: number, text: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, text);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(`${gl.getShaderInfoLog(shader)}\n${text}`);
      }
      return shader;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, source.vertex));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, source.fragment));
    ATTRIBUTES.forEach((name, location) => gl.bindAttribLocation(program, location, name));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'link failed');
    const locations = new Map<string, WebGLUniformLocation | null>();
    const entry: Program = {
      program,
      uniform: (name) => {
        if (!locations.has(name)) locations.set(name, gl.getUniformLocation(program, name));
        return locations.get(name)!;
      },
    };
    this.programs.set(source.key, entry);
    return entry;
  }
}
