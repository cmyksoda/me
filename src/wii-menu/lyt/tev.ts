import type { Material, TevOp } from './brlyt';

/** One GX TEV stage, in the shape GXSetTevOrder/ColorIn/AlphaIn/...Op take. */
interface Stage {
  texCoord: number;
  texMap: number;
  channel: number;
  rasSwap: number;
  texSwap: number;
  color: TevOp;
  alpha: TevOp;
  konstColor: number;
  konstAlpha: number;
}

const GX_COLOR0A0 = 4;
const NULL_ID = 0xff;
const KCSEL_K3_A = 0x1f;
const DEFAULT_SWAP_TABLES = [[0, 1, 2, 3], [0, 0, 0, 3], [1, 1, 1, 3], [2, 2, 2, 3]];

// Color args (GXTevColorArg) and alpha args (GXTevAlphaArg), in enum order.
const C = { CPREV: 0, C0: 2, C1: 4, TEXC: 8, RASC: 10, KONST: 14, ZERO: 15 };
const A = { APREV: 0, A0: 1, A1: 2, TEXA: 4, RASA: 5, KONST: 6, ZERO: 7 };

const add = (a: number, b: number, c: number, d: number): TevOp => (
  { a, b, c, d, op: 0, bias: 0, scale: 0, clamp: true, dest: 0 }
);

function stage(texCoord: number, texMap: number, channel: number, color: TevOp, alpha: TevOp, konst = 0x0c): Stage {
  return { texCoord, texMap, channel, rasSwap: 0, texSwap: 0, color, alpha, konstColor: konst, konstAlpha: konst };
}

/** The stages lyt::Material::SetupGX builds when a material has none of its own. */
function defaultStages(textureCount: number): Stage[] {
  const raster = stage(NULL_ID, NULL_ID, GX_COLOR0A0,
    add(C.ZERO, C.CPREV, C.RASC, C.ZERO), add(A.ZERO, A.APREV, A.RASA, A.ZERO));
  if (textureCount === 0) {
    return [stage(NULL_ID, NULL_ID, GX_COLOR0A0, add(C.ZERO, C.C1, C.RASC, C.ZERO), add(A.ZERO, A.A1, A.RASA, A.ZERO))];
  }
  // C0/C1 map black and white onto other colors; with their defaults (black, white) this is a no-op.
  const mapping = stage(NULL_ID, NULL_ID, NULL_ID, add(C.C0, C.C1, C.CPREV, C.ZERO), add(A.A0, A.A1, A.APREV, A.ZERO));
  if (textureCount === 1) {
    return [stage(0, 0, NULL_ID, add(C.C0, C.C1, C.TEXC, C.ZERO), add(A.A0, A.A1, A.TEXA, A.ZERO)), raster];
  }
  if (textureCount === 2) {
    return [
      stage(0, 0, NULL_ID, add(C.ZERO, C.ZERO, C.ZERO, C.TEXC), add(A.ZERO, A.ZERO, A.ZERO, A.TEXA)),
      stage(1, 1, NULL_ID, add(C.TEXC, C.CPREV, C.KONST, C.ZERO), add(A.TEXA, A.APREV, A.KONST, A.ZERO), KCSEL_K3_A),
      mapping,
      raster,
    ];
  }
  // Three or more maps add up, each weighted by a konst channel (K3.a, K3.b, K3.g, K3.r, K2.a, ...).
  const stages: Stage[] = [];
  for (let i = 0; i < textureCount; i++) {
    const konst = KCSEL_K3_A - (i % 4) * 4 - Math.floor(i / 4);
    stages.push(stage(i, i, NULL_ID,
      add(C.ZERO, C.TEXC, C.KONST, i === 0 ? C.ZERO : C.CPREV),
      add(A.ZERO, A.TEXA, A.KONST, i === 0 ? A.ZERO : A.APREV), konst));
  }
  return [...stages, mapping, raster];
}

const COLOR_INPUTS = ['prev.rgb', 'vec3(prev.a)', 'c0.rgb', 'vec3(c0.a)', 'c1.rgb', 'vec3(c1.a)', 'c2.rgb',
  'vec3(c2.a)', 'tex.rgb', 'vec3(tex.a)', 'ras.rgb', 'vec3(ras.a)', 'vec3(1.0)', 'vec3(0.5)', 'konst.rgb', 'vec3(0.0)'];
const ALPHA_INPUTS = ['prev.a', 'c0.a', 'c1.a', 'c2.a', 'tex.a', 'ras.a', 'konst.a', '0.0'];
const DESTS = ['prev', 'c0', 'c1', 'c2'];
const SCALES = ['1.0', '2.0', '4.0', '0.5'];
const BIASES = ['0.0', '0.5', '-0.5', '0.0'];

/** GX_TEV_KCSEL/KASEL: fixed eighths, a whole konst color, or one channel of one. */
function konstSelect(selector: number, alpha: boolean): string {
  let value: string;
  if (selector < 8) value = ((8 - selector) / 8).toFixed(3);
  else if (selector < 12) value = '1.0';
  else if (selector < 16) return alpha ? `uKonst[${selector - 12}].a` : `uKonst[${selector - 12}].rgb`;
  else value = `uKonst[${(selector - 16) % 4}].${'rgba'[(selector - 16) >> 2]}`;
  return alpha ? value : `vec3(${value})`;
}

function combine(op: TevOp, alpha: boolean): string {
  const input = (i: number) => (alpha ? ALPHA_INPUTS[i] : COLOR_INPUTS[i]);
  const [a, b, c, d] = [input(op.a), input(op.b), input(op.c), input(op.d)];
  let value: string;
  if (op.op >= 8) {
    // Compare ops: only the alpha-style (per-channel) comparison is used by layouts.
    const equal = op.op & 1 ? '==' : '>';
    value = alpha
      ? `${d} + ((floor(${a} * 255.0 + 0.5) ${equal} floor(${b} * 255.0 + 0.5)) ? ${c} : 0.0)`
      : `${d} + mix(vec3(0.0), ${c}, vec3(${equal === '>' ? 'greaterThan' : 'equal'}(floor(${a} * 255.0 + 0.5), floor(${b} * 255.0 + 0.5))))`;
  } else {
    const sign = op.op === 1 ? '-' : '+';
    value = `(${d} ${sign} mix(${a}, ${b}, ${c}) + ${BIASES[op.bias]}) * ${SCALES[op.scale]}`;
  }
  // Unclamped results still saturate at the registers' signed 10-bit range.
  const [low, high] = op.clamp ? ['0.0', '1.0'] : ['-1024.0 / 255.0', '1023.0 / 255.0'];
  return alpha ? `clamp(${value}, ${low}, ${high})` : `clamp(${value}, vec3(${low}), vec3(${high}))`;
}

const COMPARES = ['false', '<', '==', '<=', '>', '!=', '>=', 'true'];

function alphaTest(material: Material): string {
  const test = material.alphaCompare;
  if (!test) return '';
  const condition = (comp: number, ref: number) => (
    comp === 0 ? 'false' : comp === 7 ? 'true' : `(alpha8 ${COMPARES[comp]} ${ref.toFixed(1)})`
  );
  const ops = ['&&', '||', '!=', '=='];
  return `float alpha8 = floor(prev.a * 255.0 + 0.5);
  if (!(${condition(test.comp0, test.ref0)} ${ops[test.op]} ${condition(test.comp1, test.ref1)})) discard;`;
}

export interface ShaderSource {
  key: string;
  vertex: string;
  fragment: string;
}

/** Builds the vertex and fragment shaders that reproduce a material's texture generators and TEV. */
export function materialShader(material: Material): ShaderSource {
  const stages: Stage[] = material.tevStages.length ? material.tevStages : defaultStages(material.texMaps.length);
  const swaps = material.swapTables ?? DEFAULT_SWAP_TABLES;
  const gens = material.texCoordGens;

  const body = stages.map((s, i) => {
    const swizzle = (table: number) => swaps[table].map((channel) => 'rgba'[channel]).join('');
    const hasTexture = s.texMap < 8 && s.texCoord < gens.length;
    const texture = hasTexture ? `texture(uTexture[${s.texMap}], vTexCoord${s.texCoord})` : 'vec4(1.0)';
    const raster = s.channel === GX_COLOR0A0 || s.channel === 0 || s.channel === 2 ? 'vRaster' : 'vec4(0.0)';
    const color = combine(s.color, false);
    const alpha = combine(s.alpha, true);
    return `// stage ${i}
  tex = ${texture}.${swizzle(s.texSwap)};
  ras = ${raster}.${swizzle(s.rasSwap)};
  konst = vec4(${konstSelect(s.konstColor, false)}, ${konstSelect(s.konstAlpha, true)});
  {
    vec3 color = ${color};
    float alpha = ${alpha};
    ${DESTS[s.color.dest]}.rgb = color;
    ${DESTS[s.alpha.dest]}.a = alpha;
  }`;
  }).join('\n  ');

  const textureCount = Math.max(0, ...stages.filter((s) => s.texMap < 8).map((s) => s.texMap + 1));
  const genCount = gens.length;
  const vertex = `#version 300 es
in vec2 aPosition;
in vec4 aRaster;
${Array.from({ length: 8 }, (_, i) => `in vec2 aTexCoord${i};`).join('\n')}
uniform vec2 uScreenHalf;
uniform vec3 uTexRowS[8];
uniform vec3 uTexRowT[8];
out vec4 vRaster;
${Array.from({ length: genCount }, (_, i) => `out vec2 vTexCoord${i};`).join('\n')}
void main() {
  gl_Position = vec4(aPosition / uScreenHalf, 0.0, 1.0);
  vRaster = aRaster;
  ${gens.map((g, i) => {
    const source = g.source >= 4 && g.source < 12 ? `aTexCoord${g.source - 4}` : 'aTexCoord0';
    return `vTexCoord${i} = vec2(dot(uTexRowS[${i}], vec3(${source}, 1.0)), dot(uTexRowT[${i}], vec3(${source}, 1.0)));`;
  }).join('\n  ')}
}`;

  const fragment = `#version 300 es
precision highp float;
uniform sampler2D uTexture[${Math.max(1, textureCount)}];
uniform vec4 uColor[3];
uniform vec4 uKonst[4];
in vec4 vRaster;
${Array.from({ length: genCount }, (_, i) => `in vec2 vTexCoord${i};`).join('\n')}
out vec4 fragColor;
void main() {
  vec4 prev = vec4(0.0);
  vec4 c0 = uColor[0];
  vec4 c1 = uColor[1];
  vec4 c2 = uColor[2];
  vec4 tex, ras, konst;
  ${body}
  ${alphaTest(material)}
  fragColor = prev;
}`;
  return { key: vertex + fragment, vertex, fragment };
}

/** Text boxes ignore their material's stages; CharWriter::SetupGX picks one of these instead. */
export function textShader(mapped: boolean, intensityFont: boolean): ShaderSource {
  const color = mapped
    ? 'vec4(mix(uColor[0].rgb, uColor[1].rgb, tex.rgb), mix(uColor[0].a, uColor[1].a, tex.a)) * vRaster'
    : intensityFont ? 'vec4(vRaster.rgb, tex.a * vRaster.a)' : 'tex * vRaster';
  const vertex = `#version 300 es
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
}`;
  const fragment = `#version 300 es
precision highp float;
uniform sampler2D uTexture[1];
uniform vec4 uColor[3];
in vec4 vRaster;
in vec2 vTexCoord0;
out vec4 fragColor;
void main() {
  vec4 tex = texture(uTexture[0], vTexCoord0);
  fragColor = ${color};
}`;
  return { key: vertex + fragment, vertex, fragment };
}
