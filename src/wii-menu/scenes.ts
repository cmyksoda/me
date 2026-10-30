import { loadSdAssets, type Assets } from './assets';
import type { Screen } from './display';
import { Fader } from './fader';
import type { Renderer } from './lyt/renderer';
import { Menu, type MenuPointer } from './menu';
import { SdMenu } from './sd-menu';
import type { Sound } from './sound';

// Black between the scenes while the console reads the next one's files (10 frames or more on hardware).
const HOLD_FRAMES = 15;

type Next = 'menu' | 'sd';

/**
 * The scene manager: the Wii Menu or the SD Card Menu, never both. Leaving one fades to black, drops
 * every scene (reserveAllSceneDestruction) and builds the other from nothing; the music plays on.
 */
export class Scenes {
  menu: Menu | null;
  sd: SdMenu | null = null;
  private readonly fader = new Fader();
  private next: Next | null = null;
  private hold = 0;
  private sdFiles: 'loading' | 'ready' | 'failed' = 'loading';

  constructor(private readonly assets: Assets, private readonly renderer: Renderer, private readonly sound: Sound) {
    this.menu = this.buildMenu();
  }

  private buildMenu(): Menu {
    const menu = new Menu(this.assets, this.renderer, this.sound);
    const footer = menu.grid.footer;
    footer.setSound(this.sound.enabled);
    menu.grid.onOptions = () => {
      this.sound.setEnabled(!this.sound.enabled);
      footer.setSound(this.sound.enabled);
    };
    menu.grid.onSd = () => this.leave('sd');
    return menu;
  }

  private buildSd(): SdMenu {
    const sd = new SdMenu(this.assets, this.renderer, this.sound, this.fader);
    sd.onLeave = () => this.leave('menu');
    return sd;
  }

  private leave(next: Next): void {
    this.next = next;
    this.fader.fadeOut();
    if (next === 'sd') {
      this.sdFiles = 'loading';
      loadSdAssets(this.assets).then(() => (this.sdFiles = 'ready'), () => (this.sdFiles = 'failed'));
    }
  }

  /** The Download button opens its link inside the click itself, or browsers block the new tab. */
  linkAt(x: number, y: number): string | null {
    return this.menu?.linkAt(x, y) ?? this.sd?.linkAt(x, y) ?? null;
  }

  wheel(delta: number): void {
    this.menu?.wheel(delta);
  }

  update(frames: number, pointer: MenuPointer): void {
    this.menu?.update(frames, pointer);
    this.sd?.update(frames, pointer);
    this.fader.update(frames);
    if (!this.next) return;
    if (this.menu || this.sd) {
      if (!this.fader.black) return;
      this.menu = this.sd = null;
      this.hold = HOLD_FRAMES;
      return;
    }
    this.hold -= frames;
    if (this.hold > 0) return;
    // A slow connection only lengthens the black; files that won't come send it back to the Wii Menu.
    if (this.next === 'sd' && this.sdFiles !== 'ready') {
      if (this.sdFiles === 'loading') return;
      this.next = 'menu';
    }
    if (this.next === 'sd') {
      this.sd = this.buildSd();
      this.fader.fadeIn();
    } else {
      // The rebuilt Wii Menu fades itself in, as it does at boot.
      this.menu = this.buildMenu();
      this.fader.clear();
    }
    this.next = null;
  }

  draw(screen: Screen, pointer: MenuPointer): void {
    this.menu?.draw(screen, pointer);
    this.sd?.draw(screen, pointer);
    this.fader.draw(this.renderer, screen);
  }
}
