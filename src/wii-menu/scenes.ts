import { loadSdAssets, type Archive, type Assets } from './assets';
import type { Screen } from './display';
import { Fader } from './fader';
import type { Renderer } from './lyt/renderer';
import { Menu, type MenuPointer } from './menu';
import { loadRotateFiles, RotateScreen } from './rotate';
import { SdMenu } from './sd-menu';
import type { Sound } from './sound';

// Black between the scenes while the console reads the next one's files (10 frames or more on hardware).
const HOLD_FRAMES = 15;

type Next = 'menu' | 'sd' | 'rotate';

/**
 * The scene manager: the Wii Menu, the SD Card Menu or the rotate screen, never two. Leaving one fades to
 * black, drops every scene (reserveAllSceneDestruction) and builds the other from nothing; the music plays on.
 */
export class Scenes {
  menu: Menu | null = null;
  sd: SdMenu | null = null;
  private rotate: RotateScreen | null = null;
  private assets: Assets | null = null;
  private readonly fader = new Fader();
  private next: Next | null = null;
  private hold = 0;
  private sdFiles: 'loading' | 'ready' | 'failed' = 'loading';
  // Fetched the first time the window is portrait, so a visitor who never holds it so downloads nothing.
  private rotateArchive: Archive | null = null;
  private rotateFiles: 'idle' | 'loading' | 'failed' = 'idle';
  // Set by a tap on the rotate screen or once the menu is up: from then on an upright window gets the menu.
  private continued = false;

  constructor(private readonly renderer: Renderer, private readonly sound: Sound) {}

  /** The Wii Menu's files have arrived: it opens now, or as soon as the window is sideways. */
  start(assets: Assets, portrait: boolean): void {
    this.assets = assets;
    if (!portrait && !this.next && !this.rotate) this.menu = this.buildMenu();
  }

  private buildMenu(): Menu {
    // The rotate screen only greets a visitor who opens the page upright; once the menu is up, it stays.
    this.continued = true;
    const menu = new Menu(this.assets!, this.renderer, this.sound);
    const footer = menu.grid.footer;
    footer.setSound(this.sound.enabled);
    menu.grid.onOptions = () => {
      this.sound.setEnabled(!this.sound.enabled);
      footer.setSound(this.sound.enabled);
      // Banner sounds load once sound is on, so each preview's can start with its picture.
      this.sound.preloadBanners([
        ...this.assets!.channels.map((channel) => `channels/${channel.id}`),
        ...this.assets!.sdChannels.map((channel) => `sd-channels/${channel.id}`),
      ]);
    };
    menu.grid.onSd = () => this.leave('sd');
    return menu;
  }

  private buildSd(): SdMenu {
    const sd = new SdMenu(this.assets!, this.renderer, this.sound, this.fader);
    sd.onLeave = () => this.leave('menu');
    return sd;
  }

  private leave(next: Next): void {
    this.next = next;
    this.fader.fadeOut();
    if (next === 'sd') {
      const assets = this.assets!;
      this.sdFiles = 'loading';
      loadSdAssets(assets).then(() => {
        this.sdFiles = 'ready';
        const { sdChanTtl } = assets.menu;
        this.renderer.prepare(sdChanTtl.layout('mn_SdcardMenuBanner_bc'), sdChanTtl.files);
        for (const channel of assets.sdChannels) this.renderer.prepare(channel.banner.layout('banner'), channel.banner.files);
        this.sound.preloadBanners(assets.sdChannels.map((channel) => `sd-channels/${channel.id}`));
      }, () => (this.sdFiles = 'failed'));
    }
  }

  /** The Download button opens its link inside the click itself, or browsers block the new tab. */
  linkAt(x: number, y: number): string | null {
    return this.menu?.linkAt(x, y) ?? this.sd?.linkAt(x, y) ?? null;
  }

  wheel(delta: number): void {
    this.menu?.wheel(delta);
  }

  /**
   * A window taller than it is wide has no room for the menu, so the rotate screen takes its place until
   * the window is sideways again: the Health and Safety screen, which the console shows before its menu.
   */
  private follow(portrait: boolean): void {
    if (this.rotateFiles === 'failed') return;
    if (!portrait) {
      if (this.rotate && !this.rotate.leaving) this.rotate.leave();
      else if (this.next === 'rotate') {
        // Turned back before the screen came: the Wii Menu was only fading out.
        this.next = null;
        this.fader.clear();
        this.sound.startMusic();
      }
      return;
    }
    if (this.rotate || this.next === 'rotate') return;
    if (this.rotateFiles === 'idle') {
      this.rotateFiles = 'loading';
      loadRotateFiles(this.renderer).then((archive) => (this.rotateArchive = archive), () => (this.rotateFiles = 'failed'));
    }
    this.sound.stopMusic();
    this.sound.stopBanner();
    if (!this.next && (this.menu || this.sd)) this.leave('rotate');
    else this.next = 'rotate';
  }

  /** The rotate screen is showing or on its way. */
  get rotating(): boolean {
    return this.rotate !== null || this.next === 'rotate';
  }

  /** What the rotate screen says, while it says it. */
  get notice(): string {
    return this.rotate && !this.rotate.leaving ? this.rotate.words : '';
  }

  /** Tapped: the rotate screen fades out and the menu comes upright, letterboxed. */
  continueUpright(): void {
    this.continued = true;
  }

  update(frames: number, pointer: MenuPointer, tall: boolean): void {
    const portrait = tall && !this.continued;
    this.menu?.update(frames, pointer);
    this.sd?.update(frames, pointer);
    this.rotate?.update(frames);
    this.fader.update(frames);
    this.follow(portrait);
    if (this.rotate?.done) {
      // Its text has faded to black already, so the Wii Menu follows after the console's pause.
      this.rotate = null;
      this.hold = HOLD_FRAMES;
      this.sound.startMusic();
    }
    // With nothing showing or on its way, a sideways window gets the Wii Menu (at boot, once its files are here).
    const sideways = !portrait || this.rotateFiles === 'failed';
    if (!this.next && sideways && this.assets && !this.menu && !this.sd && !this.rotate) this.next = 'menu';
    if (!this.next) return;
    if (this.menu || this.sd) {
      if (!this.fader.black) return;
      this.menu = this.sd = null;
      this.hold = this.next === 'rotate' ? 0 : HOLD_FRAMES;
      return;
    }
    this.hold -= frames;
    if (this.hold > 0) return;
    // A slow connection only lengthens the black; files that won't come send it back to the Wii Menu.
    if (this.next === 'sd' && this.sdFiles !== 'ready') {
      if (this.sdFiles === 'loading') return;
      this.next = 'menu';
    }
    if (this.next === 'rotate' && !this.rotateArchive) {
      if (this.rotateFiles === 'loading') return;
      this.next = null;
      return;
    }
    if (this.next === 'rotate') {
      this.rotate = new RotateScreen(this.renderer, this.rotateArchive!);
      this.fader.clear();
    } else if (this.next === 'sd') {
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
    this.rotate?.draw(screen);
    this.fader.draw(this.renderer, screen);
  }
}
