import type { Archive } from './assets';
import type { Screen } from './display';
import { AnimationPlayer, identity, type LayoutInstance, type PaneNode } from './lyt/layout';
import type { Renderer } from './lyt/renderer';

const WII_MENU_FOR = 3000;

/**
 * The channel screen's clock (iplClock.cpp), USA style: 12-hour time with no leading zero and
 * AM/PM on the right. "Wii Menu" shows for three seconds after boot, then fades into the time.
 */
export class Clock {
  private readonly instance: LayoutInstance;
  private readonly blink: AnimationPlayer;
  private readonly change: AnimationPlayer;
  private readonly bootedAt = performance.now();
  private showingTime = false;
  private shown = '';
  private blinkedAt = -1;

  constructor(archive: Archive, messages: Record<string, string>) {
    this.instance = archive.instance('my_Clock_a');
    this.blink = new AnimationPlayer(archive.animation('my_Clock_a_Min')!, this.instance);
    this.change = new AnimationPlayer(archive.animation('my_Clock_a_Change')!, this.instance);
    this.instance.pane('T_WiiMenu').text = messages['16'];
    this.instance.pane('AM_PM').visible = false;
    this.change.seek(this.change.from);
  }

  private digit(pane: string, donor: string): void {
    const target = this.instance.pane(pane);
    const source = this.instance.pane(donor);
    const material = (node: PaneNode) => this.instance.materials[node.source.picture!.material];
    material(target).textures[0] = material(source).textures[0];
  }

  /** Swaps digit textures the moment the minute changes, as change_tex does. */
  private setTime(now: Date): void {
    const hours = now.getHours();
    const key = `${hours}:${now.getMinutes()}`;
    if (key === this.shown) return;
    this.shown = key;
    const twelve = hours % 12 || 12;
    this.instance.pane('Clock3').visible = twelve >= 10;
    this.digit('Clock3', `Num${Math.floor(twelve / 10)}`);
    this.digit('Clock2', `Num${twelve % 10}`);
    this.digit('Clock1', `Num${Math.floor(now.getMinutes() / 10)}`);
    this.digit('Clock0', `Num${now.getMinutes() % 10}`);
    this.digit('AM_PM_R', hours < 12 ? 'AM' : 'PM');
  }

  update(frames: number): void {
    const now = new Date();
    this.setTime(now);
    if (!this.showingTime && performance.now() - this.bootedAt >= WII_MENU_FOR && now.getSeconds() % 2 === 1) {
      this.showingTime = true;
      this.change.play();
    }
    this.change.step(frames);
    // The colon dims on every even second and comes back about a second later.
    if (this.showingTime && !this.blink.playing && now.getSeconds() % 2 === 0 && this.blinkedAt !== now.getSeconds()) {
      this.blinkedAt = now.getSeconds();
      this.blink.play();
    }
    this.blink.step(frames);
  }

  /** The menu draws one clock at each N_Clock anchor of the grid, so a copy rides in when paging. */
  draw(renderer: Renderer, screen: Screen, anchors: PaneNode[]): void {
    const root = this.instance.pane('N_WiiMenu');
    for (const anchor of anchors) {
      root.translate[0] = anchor.world[3];
      root.translate[1] = anchor.world[7];
      this.instance.update(identity(), screen);
      renderer.drawLayout(this.instance);
    }
  }
}
