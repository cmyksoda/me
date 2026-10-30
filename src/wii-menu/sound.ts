/** The menu's sound effects and channel banner sounds; silent until the visitor turns sound on. */
export class Sound {
  enabled = false;

  play(name: string): void {
    if (!this.enabled) return;
    void name;
  }
}
