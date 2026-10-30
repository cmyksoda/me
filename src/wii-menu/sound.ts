import { root } from './assets';

interface Cue {
  file: string;
  channels: number;
  loop: boolean;
  loopStart?: number;
  loopEnd?: number;
  /** Linear gain to play at; sequence renders already carry the console's own volumes. */
  gain: number;
  /** Notes started per kind of wave (sequences only), which decides how the cue pans. */
  noteWaves?: { mono: number; stereo: number };
}

/** A held cue's controls, given again every update it's held. */
export interface HoldControls {
  /** −1 (left) to 1 (right). */
  pan?: number;
  volume?: number;
  pitch?: number;
}

interface Voice {
  source: AudioBufferSourceNode;
  gain: GainNode;
  baseGain: number;
  pan: ((pan: number) => void) | null;
}

interface Hold {
  voice: Voice | null;
  held: boolean;
  controls: HoldControls;
}

interface StartOptions {
  loop?: { start?: number; end?: number };
  pan?: { cue: Cue; value: number };
  volume?: number;
  delay?: number;
}

const MUSIC = 'WIPL_BGM_MENU';
const JINGLE = 'WIPL_SE_WII_START';
// startSE restarts a cue that's already playing, except these two (snd::System::startSE).
const NOT_RESTARTED = ['WIPL_SE_GRAY_BUTTON', 'WIPL_SE_ERROR'];
const UPDATE = 1 / 60;
// AX ramps every volume change over 96 samples.
const RAMP = 0.003;
// The console mixes at 32 kHz; decoding at that rate keeps its band limit.
const SAMPLE_RATE = 32000;

const clamp = (value: number) => Math.max(-1, Math.min(1, value));
// snd::Util::CalcPanRatio's table is this square root, to within float precision.
const ratio = (pan: number) => Math.sqrt((1 - clamp(pan)) / 2);

/**
 * Pans a baked two-channel cue as the console pans its notes. Mono-wave notes were baked centered,
 * so each side just scales; stereo-wave notes keep a voice per side, which the pan mixes across.
 */
function panner(context: AudioContext, cue: Cue, input: AudioNode, output: AudioNode, pan: number): (pan: number) => void {
  const split = context.createChannelSplitter(2);
  const merge = context.createChannelMerger(2);
  const gains = [0, 1].map((from) => [0, 1].map((to) => {
    const gain = context.createGain();
    split.connect(gain, from).connect(merge, 0, to);
    return gain;
  }));
  input.connect(split);
  merge.connect(output);
  const mono = cue.noteWaves?.stereo === 0;
  const matrix = (p: number) => mono
    ? [[Math.sqrt(1 - clamp(p)), 0], [0, Math.sqrt(1 + clamp(p))]]
    : [[ratio(p - 1), ratio(1 - p)], [ratio(p + 1), ratio(-1 - p)]];
  matrix(pan).forEach((row, from) => row.forEach((value, to) => (gains[from][to].gain.value = value)));
  return (p) => matrix(p).forEach((row, from) => row.forEach((value, to) => {
    gains[from][to].gain.setTargetAtTime(value, context.currentTime, RAMP);
  }));
}

function makeContext(): AudioContext {
  try {
    return new AudioContext({ sampleRate: SAMPLE_RATE });
  } catch {
    return new AudioContext();
  }
}

/**
 * The menu's sound: effects, the menu music and each channel's banner sound. Nothing is fetched
 * until a visitor turns sound on with the Wii button, and it starts off, as browsers expect.
 */
export class Sound {
  enabled = false;
  private context: AudioContext | null = null;
  private cues: Promise<Record<string, Cue>> | null = null;
  private readonly buffers = new Map<string, Promise<AudioBuffer | null>>();
  private readonly voices = new Map<string, Voice>();
  private readonly holds = new Map<string, Hold>();
  private music: Voice | null = null;
  private musicWanted = false;
  private booted = false;
  private banner: Voice | null = null;
  private bannerRequest = 0;

  /** Browsers only let audio start inside a click, so every press comes through here first. */
  unlock(): void {
    try {
      this.context ??= makeContext();
      if (this.context.state === 'suspended') void this.context.resume();
    } catch {}
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (on) {
      this.cues ??= fetch(new URL('sound/sounds.json', root)).then((r) => r.json()).then((m) => m.sounds);
      if (this.booted) {
        this.startMusic();
        return;
      }
      // The first time sound comes on is the menu's first boot: its jingle and the music start together.
      this.booted = true;
      const cues = this.cues;
      void cues.then(async (all) => {
        const jingle = all[JINGLE] && (await this.load(`sound/${all[JINGLE].file}`));
        await (all[MUSIC] && this.load(`sound/${all[MUSIC].file}`));
        if (jingle && this.enabled) this.track(JINGLE, this.start(jingle, all[JINGLE].gain));
        this.startMusic();
      });
    } else {
      this.musicWanted = false;
      for (const voice of [...this.voices.values(), this.music, this.banner]) this.stopVoice(voice, 0);
      for (const hold of this.holds.values()) this.stopVoice(hold.voice, 0);
      this.voices.clear();
      this.holds.clear();
      this.music = null;
      this.banner = null;
    }
  }

  private load(path: string): Promise<AudioBuffer | null> {
    let buffer = this.buffers.get(path);
    if (!buffer) {
      buffer = fetch(new URL(path, root))
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(path))))
        .then((data) => this.context!.decodeAudioData(data))
        .catch(() => null);
      this.buffers.set(path, buffer);
    }
    return buffer;
  }

  private start(buffer: AudioBuffer, gain: number, options: StartOptions = {}): Voice {
    const context = this.context!;
    const source = context.createBufferSource();
    source.buffer = buffer;
    if (options.loop) {
      source.loop = true;
      source.loopStart = options.loop.start ?? 0;
      source.loopEnd = options.loop.end ?? buffer.duration;
    }
    const node = context.createGain();
    node.gain.value = gain * (options.volume ?? 1);
    const { pan } = options;
    let setPan: Voice['pan'] = null;
    if (pan && buffer.numberOfChannels === 2) setPan = panner(context, pan.cue, source, node, pan.value);
    else source.connect(node);
    node.connect(context.destination);
    source.start(context.currentTime + (options.delay ?? 0));
    return { source, gain: node, baseGain: gain, pan: setPan };
  }

  /** Fades a voice out in steps of one update, as the console's stop fades do; 0 cuts it at once. */
  private stopVoice(voice: Voice | null, frames: number): void {
    if (!voice || !this.context) return;
    const now = this.context.currentTime;
    const param = voice.gain.gain;
    const from = param.value;
    param.cancelScheduledValues(now);
    param.setValueAtTime(from, now);
    if (frames > 0) {
      for (let step = 1; step <= frames; step++) param.setValueAtTime(from * (1 - step / frames), now + step * UPDATE);
    } else {
      param.linearRampToValueAtTime(0, now + RAMP);
    }
    try {
      voice.source.stop(now + Math.max(frames * UPDATE, RAMP));
    } catch {}
  }

  private loopOf(cue: Cue): StartOptions['loop'] {
    return cue.loop ? { start: cue.loopStart, end: cue.loopEnd } : undefined;
  }

  /** Starts a cue (startSE); a `pan` places it like startSEwithPos, from −1 (left) to 1 (right). */
  play(name: string, pan?: number): void {
    if (!this.enabled || !this.context || !this.cues) return;
    void this.cues.then(async (cues) => {
      const cue = cues[name];
      if (!cue) return;
      const buffer = await this.load(`sound/${cue.file}`);
      if (!buffer || !this.enabled) return;
      const playing = this.voices.get(name);
      if (playing && NOT_RESTARTED.includes(name)) return;
      this.stopVoice(playing ?? null, 0);
      this.track(name, this.start(buffer, cue.gain, {
        loop: this.loopOf(cue),
        pan: pan === undefined ? undefined : { cue, value: pan },
      }));
    });
  }

  /** One voice per cue name, forgotten once it ends. */
  private track(name: string, voice: Voice): void {
    this.voices.set(name, voice);
    voice.source.onended = () => {
      if (this.voices.get(name) === voice) this.voices.delete(name);
    };
  }

  /** Keeps a looping cue playing while it's held every update (holdSE), steered by its controls. */
  hold(name: string, controls: HoldControls = {}): void {
    if (!this.enabled || !this.context || !this.cues) return;
    let hold = this.holds.get(name);
    if (!hold) {
      const entry: Hold = { voice: null, held: true, controls };
      this.holds.set(name, entry);
      hold = entry;
      void this.cues.then(async (cues) => {
        const cue = cues[name];
        const buffer = cue && (await this.load(`sound/${cue.file}`));
        if (!buffer || this.holds.get(name) !== entry) return;
        const { pan = 0, volume, pitch } = entry.controls;
        entry.voice = this.start(buffer, cue.gain, { loop: this.loopOf(cue), pan: { cue, value: pan }, volume });
        if (pitch !== undefined) entry.voice.source.playbackRate.value = pitch;
      });
    }
    hold.held = true;
    hold.controls = controls;
    const voice = hold.voice;
    if (!voice) return;
    const now = this.context.currentTime;
    voice.gain.gain.setTargetAtTime(voice.baseGain * (controls.volume ?? 1), now, RAMP);
    if (controls.pitch !== undefined) voice.source.playbackRate.setValueAtTime(controls.pitch, now);
    voice.pan?.(controls.pan ?? 0);
  }

  /** Closes an update: a held cue that nothing held this time stops. */
  endUpdate(): void {
    for (const [name, hold] of this.holds) {
      if (hold.held) {
        hold.held = false;
        continue;
      }
      this.stopVoice(hold.voice, 0);
      this.holds.delete(name);
    }
  }

  /** The menu music; it stops (not pauses) while a preview is open and starts over afterward. */
  startMusic(delayFrames = 0): void {
    this.musicWanted = true;
    if (!this.enabled || !this.context || !this.cues || this.music) return;
    void this.cues.then(async (cues) => {
      const cue = cues[MUSIC];
      const buffer = cue && (await this.load(`sound/${cue.file}`));
      if (!buffer || !this.enabled || !this.musicWanted || this.music) return;
      this.music = this.start(buffer, cue.gain, { loop: this.loopOf(cue), delay: delayFrames * UPDATE });
    });
  }

  stopMusic(frames = 0): void {
    this.musicWanted = false;
    this.stopVoice(this.music, frames);
    this.music = null;
  }

  /**
   * A channel's banner sound, `sound.flac` and `sound.json` in its folder (written by
   * tools/wii/convert_channel_sound.py), starting `delayFrames` updates from now.
   */
  playBanner(folder: string, delayFrames = 0): void {
    if (!this.enabled || !this.context) return;
    this.stopBanner();
    const request = ++this.bannerRequest;
    void (async () => {
      const info = await fetch(new URL(`${folder}/sound.json`, root))
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      const buffer = info && (await this.load(`${folder}/sound.flac`));
      // A newer request (or a stop) while this one loaded wins.
      if (!buffer || !this.enabled || request !== this.bannerRequest) return;
      this.banner = this.start(buffer, info.gain ?? 1, {
        loop: info.loop ? { start: info.loopStart, end: info.loopEnd } : undefined,
        delay: delayFrames * UPDATE,
      });
    })();
  }

  /** Stops the banner sound, at once or over `frames` updates. */
  stopBanner(frames = 0): void {
    this.bannerRequest++;
    this.stopVoice(this.banner, frames);
    this.banner = null;
  }
}
