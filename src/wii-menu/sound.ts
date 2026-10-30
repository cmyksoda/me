import { root, type Channel } from './assets';

interface Cue {
  file: string;
  loop: boolean;
  loopStart?: number;
  loopEnd?: number;
  /** Linear gain to play at; sequence renders already carry the console's own volumes. */
  gain: number;
}

interface Voice {
  source: AudioBufferSourceNode;
  gain: GainNode;
}

const MUSIC = 'WIPL_BGM_MENU';
// startSE restarts a cue that's already playing, except these two (snd::System::startSE).
const NOT_RESTARTED = ['WIPL_SE_GRAY_BUTTON', 'WIPL_SE_ERROR'];
const UPDATE = 1 / 60;

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
  private music: Voice | null = null;
  private musicWanted = false;
  private banner: Voice | null = null;
  private bannerRequest = 0;

  /** Browsers only let audio start inside a click, so every press comes through here first. */
  unlock(): void {
    try {
      this.context ??= new AudioContext();
      if (this.context.state === 'suspended') void this.context.resume();
    } catch {}
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (on) {
      this.cues ??= fetch(new URL('sound/sounds.json', root)).then((r) => r.json()).then((m) => m.sounds);
      this.startMusic();
    } else {
      this.musicWanted = false;
      for (const voice of [...this.voices.values(), this.music, this.banner]) this.stopVoice(voice, 0);
      this.voices.clear();
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

  private start(buffer: AudioBuffer, gain: number, loop?: { start?: number; end?: number }): Voice {
    const context = this.context!;
    const source = context.createBufferSource();
    source.buffer = buffer;
    if (loop) {
      source.loop = true;
      source.loopStart = loop.start ?? 0;
      source.loopEnd = loop.end ?? buffer.duration;
    }
    const node = context.createGain();
    node.gain.value = gain;
    source.connect(node).connect(context.destination);
    source.start();
    return { source, gain: node };
  }

  /** Fades a voice out over `frames` menu updates (0 stops it at once). */
  private stopVoice(voice: Voice | null, frames: number): void {
    if (!voice || !this.context) return;
    const end = this.context.currentTime + frames * UPDATE;
    voice.gain.gain.setValueAtTime(voice.gain.gain.value, this.context.currentTime);
    voice.gain.gain.linearRampToValueAtTime(0, end);
    try {
      voice.source.stop(end);
    } catch {}
  }

  play(name: string): void {
    if (!this.enabled || !this.context || !this.cues) return;
    void this.cues.then(async (cues) => {
      const cue = cues[name];
      if (!cue) return;
      const buffer = await this.load(`sound/${cue.file}`);
      if (!buffer || !this.enabled) return;
      const playing = this.voices.get(name);
      if (playing && NOT_RESTARTED.includes(name)) return;
      this.stopVoice(playing ?? null, 0);
      const voice = this.start(buffer, cue.gain, cue.loop ? { start: cue.loopStart, end: cue.loopEnd } : undefined);
      this.voices.set(name, voice);
      voice.source.onended = () => {
        if (this.voices.get(name) === voice) this.voices.delete(name);
      };
    });
  }

  /** The menu music; it stops (not pauses) while a preview is open and starts over afterward. */
  startMusic(): void {
    this.musicWanted = true;
    if (!this.enabled || !this.context || !this.cues || this.music) return;
    void this.cues.then(async (cues) => {
      const cue = cues[MUSIC];
      const buffer = cue && (await this.load(`sound/${cue.file}`));
      if (!buffer || !this.enabled || !this.musicWanted || this.music) return;
      this.music = this.start(buffer, cue.gain, { start: cue.loopStart, end: cue.loopEnd });
    });
  }

  stopMusic(frames = 0): void {
    this.musicWanted = false;
    this.stopVoice(this.music, frames);
    this.music = null;
  }

  /** A channel's banner sound, decoded from its sound.bin by tools/wii/convert_channel_sound.py. */
  playBanner(channel: Channel): void {
    if (!this.enabled || !this.context) return;
    this.stopBanner();
    const request = ++this.bannerRequest;
    void (async () => {
      const info = await fetch(new URL(`channels/${channel.id}/sound.json`, root))
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      const buffer = info && (await this.load(`channels/${channel.id}/sound.flac`));
      // A newer request (or a stop) while this one loaded wins.
      if (!buffer || !this.enabled || request !== this.bannerRequest) return;
      this.banner = this.start(buffer, info.gain ?? 1, info.loop ? { start: info.loopStart, end: info.loopEnd } : undefined);
    })();
  }

  /** Stops the banner sound, at once or over `frames` updates. */
  stopBanner(frames = 0): void {
    this.bannerRequest++;
    this.stopVoice(this.banner, frames);
    this.banner = null;
  }
}
