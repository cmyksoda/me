import type { Archive } from './assets';
import type { Screen } from './display';
import { identity, type LayoutInstance } from './lyt/layout';
import type { Renderer } from './lyt/renderer';

/** Player 1's pointer: the hand, or the grabbing hand while a channel is held (P1_Def / P1_Cat). */
export class Cursor {
  private readonly hand: LayoutInstance;
  private readonly grab: LayoutInstance;

  constructor(archive: Archive) {
    this.hand = archive.instance('P1_Def');
    this.grab = archive.instance('P1_Cat');
  }

  /** PointerCoreObject::calc writes the position into N_Trans, which undoes the wide root stretch. */
  draw(renderer: Renderer, screen: Screen, x: number, y: number, grabbing: boolean): void {
    const layout = grabbing ? this.grab : this.hand;
    layout.pane('N_Trans').translate = [x * (608 / screen.width), y, 0];
    layout.update(identity(), screen);
    renderer.drawLayout(layout);
  }
}
