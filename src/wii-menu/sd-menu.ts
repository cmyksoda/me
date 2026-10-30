import type { Assets, SdChannel } from './assets';
import { Cursor } from './cursor';
import { Dialog } from './dialog';
import { SCREEN_HEIGHT, type Screen } from './display';
import type { Fader } from './fader';
import { center } from './lyt/hit';
import type { Rect, Renderer } from './lyt/renderer';
import type { MenuPointer } from './menu';
import { Preview, type PreviewStyle } from './preview';
import { SdGrid } from './sd-grid';
import type { Sound } from './sound';

const ZOOM_FRAMES = 28;
const WELCOMED_KEY = 'wii-forwarders.sd-welcome-read';
// Jaxi's own welcome stands in for Nintendo's four pages; the line breaks follow the console's dialog widths.
const WELCOME = 'Welcome to the SD Card Menu!\n\nHere, you can find modified\nversions of official Nintendo\n'
  + 'channels. Their downloads are\nhosted on the Internet Archive.';

type State = 'fadingIn' | 'grid' | 'zoomIn' | 'preview' | 'zoomOut' | 'leaving' | 'left';

/** Smoothstep, as the menu's zero-tangent HermiteIntp. */
const ease = (t: number) => t * t * (3 - 2 * t);

/**
 * The SD Card Menu's scenes (SDButton, SDChannelSelect, SDChannelTitle, SDArrow): the grid of the
 * card's channels, the welcome (also behind the "?" button), and the zoom into a channel's preview and back.
 */
export class SdMenu {
  readonly grid: SdGrid;
  /** The Wii button was pressed: the screen should fade out to the Wii Menu. */
  onLeave: (() => void) | null = null;
  private readonly cursor: Cursor;
  private readonly dialog: Dialog;
  private state: State = 'fadingIn';
  private preview: Preview<SdChannel> | null = null;
  private shownChannel: SdChannel | null = null;
  /** Updates the preview has taken input for; Start (Download here) answers from the second. */
  private live = 0;
  private zoom = 0;
  private slotRect: Rect = [0, 0, 0, 0];
  private screen: Screen | null = null;

  constructor(
    private readonly assets: Assets,
    private readonly renderer: Renderer,
    private readonly sound: Sound,
    private readonly fader: Fader,
  ) {
    this.grid = new SdGrid(assets, renderer, sound);
    this.cursor = new Cursor(assets.menu.cursor);
    this.dialog = new Dialog(assets.menu.dlgWdw, sound);

    this.grid.onSelect = (channel) => this.open(channel);
    this.grid.onHelp = () => this.dialog.openOne(WELCOME, this.closeLabel, () => {});
    this.grid.onWiiMenu = () => {
      this.state = 'leaving';
    };
    // A visitor who has seen the welcome has the card read while the screen fades in.
    if (this.welcomed) this.grid.readCard();
  }

  private get welcomed(): boolean {
    try {
      return localStorage.getItem(WELCOMED_KEY) === '1';
    } catch {
      return false;
    }
  }

  private get closeLabel(): string {
    return this.assets.messages['164'];
  }

  /** The welcome closes: didntGotoSDMenu is cleared and saved, and only then is the card read. */
  private closeWelcome(): void {
    try {
      localStorage.setItem(WELCOMED_KEY, '1');
    } catch {}
    this.grid.readCard();
  }

  private rectFor(channel: SdChannel): Rect {
    const { index } = this.grid.locate(channel);
    const [x, y] = center(this.grid.slotPane(index));
    const halfWidth = this.screen!.wide ? 85 : 64;
    return [x - halfWidth, y + 48, x + halfWidth, y - 48];
  }

  private open(channel: SdChannel): void {
    const style: PreviewStyle = {
      archive: this.assets.menu.sdChanTtl,
      layout: 'mn_SdcardMenuBanner_bc',
      back: this.assets.messages['162'],
      sounds: 'sd-channels',
    };
    this.preview = new Preview(this.assets, this.renderer, this.sound, channel, style);
    this.preview.setDownload(channel.download !== null, true);
    this.shownChannel = channel;
    this.slotRect = this.rectFor(channel);
    this.grid.footer.setArrows(false, false);
    this.grid.footer.disable();
    this.grid.zoomMask(true);
    this.sound.stopMusic(5);
    this.sound.play('WIPL_SE_CH_SELECT');
    this.state = 'zoomIn';
    this.zoom = 0;
  }

  private close(): void {
    const preview = this.preview!;
    preview.halt();
    this.grid.showPage(this.grid.locate(preview.channel).page);
    this.slotRect = this.rectFor(preview.channel);
    this.grid.zoomMask(false);
    this.sound.play('WIPL_SE_CH_UNSELECT');
    this.sound.stopBanner(ZOOM_FRAMES);
    this.grid.footer.setArrows(false, false);
    this.state = 'zoomOut';
  }

  /** The Download button opens the WAD's Internet Archive page inside the click itself, or browsers block the new tab. */
  linkAt(x: number, y: number): string | null {
    const preview = this.preview;
    if (this.state !== 'preview' || !preview || preview.busy || this.live <= 0) return null;
    return preview.hit(x, y) === 'download' ? preview.channel.download : null;
  }

  update(frames: number, pointer: MenuPointer): void {
    if (this.state === 'leaving') {
      // initCalcFadeout runs the update after the press; the footer is already dead.
      this.state = 'left';
      this.onLeave?.();
    }
    const active = this.state === 'grid' && !this.dialog.busy && this.fader.idle && pointer.inside;
    this.grid.update(frames, pointer, active);
    if (this.state === 'grid' && !this.dialog.busy && this.fader.idle && !pointer.inside) this.grid.pointAway();
    this.preview?.update(frames);

    if (this.state === 'fadingIn' && this.fader.idle) {
      this.state = 'grid';
      if (!this.welcomed) this.dialog.openOne(WELCOME, this.closeLabel, () => this.closeWelcome());
    } else if (this.state === 'zoomIn') {
      this.zoom = Math.min(ZOOM_FRAMES, this.zoom + frames);
      if (this.zoom >= ZOOM_FRAMES) {
        this.state = 'preview';
        this.live = 0;
        this.preview!.begin(1);
        this.grid.footer.setArrows(true, true);
      }
    } else if (this.state === 'zoomOut') {
      this.zoom = Math.max(0, this.zoom - frames);
      if (this.zoom <= 0) {
        this.state = 'grid';
        this.preview = null;
        this.grid.resume();
        this.sound.startMusic(2);
      }
    } else if (this.state === 'preview') {
      this.updatePreview(frames, pointer);
    }
    this.dialog.update(frames, pointer);
  }

  private updatePreview(frames: number, pointer: MenuPointer): void {
    const preview = this.preview!;
    const footer = this.grid.footer;
    if (preview.channel !== this.shownChannel) {
      // The swap to the next channel's banner: Download grays out or lights up with it.
      this.shownChannel = preview.channel;
      preview.setDownload(preview.channel.download !== null);
    }
    if (preview.busy || !pointer.inside) {
      this.live = 0;
      preview.release();
      if (!pointer.inside && footer.hovered) footer.leave(footer.hovered);
      return;
    }
    const ready = this.live > 0;
    this.live += frames;
    const side = footer.hit(pointer.x, pointer.y);
    if (side !== footer.hovered) {
      if (footer.hovered) footer.leave(footer.hovered);
      if (side) footer.point(side);
    }
    const button = side ? null : preview.hit(pointer.x, pointer.y);
    preview.point(button);
    if (!pointer.aPressed) return;
    if (side === 'left' || side === 'right') {
      footer.pressArrow(side);
      preview.change(this.grid.neighbor(preview.channel, side === 'left' ? -1 : 1));
    } else if (button === 'back') {
      preview.press('back');
      this.close();
    } else if (button === 'download') {
      if (preview.channel.download && ready) preview.press('download');
      else this.sound.play('WIPL_SE_GRAY_BUTTON');
    }
  }

  private zoomRect(): Rect {
    const h = ease(this.zoom / ZOOM_FRAMES);
    const half = this.screen!.width / 2;
    const full: Rect = [-half, SCREEN_HEIGHT / 2, half, -SCREEN_HEIGHT / 2];
    return full.map((value, i) => value + (this.slotRect[i] - value) * h) as Rect;
  }

  draw(screen: Screen, pointer: MenuPointer): void {
    this.screen = screen;
    const renderer = this.renderer;
    const zooming = this.state === 'zoomIn' || this.state === 'zoomOut';
    if (zooming) {
      const [left, top, right, bottom] = this.zoomRect();
      renderer.camera = {
        x: (left + right) / 2,
        y: (top + bottom) / 2,
        scaleX: screen.width / (right - left),
        scaleY: SCREEN_HEIGHT / (top - bottom),
      };
    }
    if (this.state === 'preview') {
      this.preview!.draw(screen);
    } else {
      // SDButton (backdrop and footer), then SDChannelSelect over it.
      this.grid.footer.draw(screen);
      this.grid.draw(screen);
    }
    if (zooming) {
      // The captured preview fades in over the slot with black all around it.
      renderer.capture(() => this.preview!.draw(screen));
      const alpha = Math.floor(ease(this.zoom / ZOOM_FRAMES) * 255) / 255;
      const [sl, st, sr, sb] = this.slotRect;
      const far = 100000;
      const black: [number, number, number, number] = [0, 0, 0, alpha * 255];
      renderer.fill([-far, far, far, st], black);
      renderer.fill([-far, sb, far, -far], black);
      renderer.fill([-far, st, sl, sb], black);
      renderer.fill([sr, st, far, sb], black);
      renderer.drawCapture(this.slotRect, alpha);
      renderer.camera = null;
    }
    this.grid.footer.drawArrows(screen);
    this.dialog.draw(renderer, screen);
    if (pointer.inside) this.cursor.draw(renderer, screen, pointer.x, pointer.y, false);
  }
}
