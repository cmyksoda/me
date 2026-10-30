import type { Channel } from './assets';

/** The menu's sound effects and channel banner sounds; silent until the visitor turns sound on. */
export class Sound {
  enabled = false;

  play(name: string): void {
    if (!this.enabled) return;
    void name;
  }

  playBanner(channel: Channel): void {
    if (!this.enabled) return;
    void channel;
  }

  /** The menu music; it stops (not pauses) while a preview is open and starts over afterward. */
  startMusic(): void {}

  stopMusic(frames = 0): void {
    void frames;
  }

  /** Stops the banner sound, at once or over `frames` updates. */
  stopBanner(frames = 0): void {
    void frames;
  }
}
