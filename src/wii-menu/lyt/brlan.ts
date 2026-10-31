import { Reader, sections } from './binary';

/** RLPA pane SRT, RLVI visibility, RLVC vertex color + alpha, RLMC material color,
 *  RLTS texture SRT, RLTP texture pattern, RLIM indirect matrix. */
export type TrackKind = 'RLPA' | 'RLVI' | 'RLVC' | 'RLMC' | 'RLTS' | 'RLTP' | 'RLIM';

export interface Key {
  frame: number;
  value: number;
  slope: number;
}

export interface Track {
  kind: TrackKind;
  /** Texture map or SRT index for material tracks. */
  index: number;
  target: number;
  stepped: boolean;
  keys: Key[];
}

export interface AnimationTarget {
  name: string;
  isMaterial: boolean;
  tracks: Track[];
}

export interface Animation {
  frameSize: number;
  loop: boolean;
  /** Texture names that RLTP keys index into. */
  textures: string[];
  targets: AnimationTarget[];
}

export function parseBRLAN(bytes: Uint8Array): Animation {
  const r = new Reader(bytes);
  const animation: Animation = { frameSize: 0, loop: false, textures: [], targets: [] };
  for (const [kind, at] of sections(r, 'RLAN')) {
    if (kind !== 'pai1') continue;
    animation.frameSize = r.u16(at + 8);
    animation.loop = r.u8(at + 10) !== 0;
    const textureTable = at + 20;
    for (let i = 0; i < r.u16(at + 12); i++) {
      animation.textures.push(r.string(textureTable + r.u32(textureTable + i * 4)));
    }
    const targetTable = at + r.u32(at + 16);
    for (let i = 0; i < r.u16(at + 14); i++) {
      const base = at + r.u32(targetTable + i * 4);
      const target: AnimationTarget = { name: r.string(base, 20), isMaterial: r.u8(base + 21) === 1, tracks: [] };
      for (let j = 0; j < r.u8(base + 20); j++) {
        const info = base + r.u32(base + 24 + j * 4);
        const kind = r.fourcc(info) as TrackKind;
        for (let k = 0; k < r.u8(info + 4); k++) {
          const track = info + r.u32(info + 8 + k * 4);
          const stepped = r.u8(track + 2) === 1;
          const keyAt = track + r.u32(track + 8);
          const keys: Key[] = [];
          for (let m = 0; m < r.u16(track + 4); m++) {
            if (stepped) {
              keys.push({ frame: r.f32(keyAt + m * 8), value: r.u16(keyAt + m * 8 + 4), slope: 0 });
            } else {
              const at = keyAt + m * 12;
              keys.push({ frame: r.f32(at), value: r.f32(at + 4), slope: r.f32(at + 8) });
            }
          }
          target.tracks.push({ kind, index: r.u8(track), target: r.u8(track + 1), stepped, keys });
        }
      }
      animation.targets.push(target);
    }
  }
  return animation;
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.001;

/** Binary search for the keys around `frame`, as lyt_animation.cpp does. */
function bracket(keys: Key[], frame: number, inclusive: boolean): [number, number] {
  let left = 0;
  let right = keys.length - 1;
  while (left !== right - 1 && left !== right) {
    const center = (left + right) >> 1;
    if (inclusive ? frame <= keys[center].frame : frame < keys[center].frame) right = center;
    else left = center;
  }
  return [left, right];
}

export function sampleStep(keys: Key[], frame: number): number {
  const last = keys.length - 1;
  if (last === 0 || frame <= keys[0].frame) return keys[0].value;
  if (frame >= keys[last].frame) return keys[last].value;
  const [left, right] = bracket(keys, frame, false);
  return near(frame, keys[right].frame) ? keys[right].value : keys[left].value;
}

export function sampleHermite(keys: Key[], frame: number): number {
  const last = keys.length - 1;
  if (last === 0 || frame <= keys[0].frame) return keys[0].value;
  if (frame >= keys[last].frame) return keys[last].value;
  const [left, right] = bracket(keys, frame, true);
  const k0 = keys[left];
  const k1 = keys[right];
  if (near(frame, k1.frame)) {
    // Two keys on one frame make a jump; past it, the later key wins.
    return right < last && keys[right + 1].frame === k1.frame ? keys[right + 1].value : k1.value;
  }
  const t1 = frame - k0.frame;
  const t2 = 1 / (k1.frame - k0.frame);
  const a = t1 * t1 * t2;
  const b = a * t2;
  const c = t1 * b;
  const d = c * t2;
  return k0.value * (2 * d - 3 * b + 1) + k1.value * (-2 * d + 3 * b)
    + k0.slope * (c - 2 * a + t1) + k1.slope * (c - a);
}

export function sampleTrack(track: Track, frame: number): number {
  return track.stepped ? sampleStep(track.keys, frame) : sampleHermite(track.keys, frame);
}
