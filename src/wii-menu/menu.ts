import type { Assets, Channel } from './assets';
import { Cursor } from './cursor';
import { SCREEN_HEIGHT, type Screen } from './display';
import { ChannelGrid, type Pointer } from './grid';
import { center } from './lyt/hit';
import type { Rect, Renderer } from './lyt/renderer';
import { Preview } from './preview';
import type { Sound } from './sound';

const ZOOM_FRAMES = 28;
const FADE_FRAMES = 20;

type State = 'grid' | 'zoomIn' | 'preview' | 'zoomOut';

/** Smoothstep, as the menu's zero-tangent HermiteIntp. */
const ease = (t: number) => t * t * (3 - 2 * t);

/** Runs the scenes the way the menu's scene tree does: grid, the zoom, the preview and back. */
export class Menu {
  readonly grid: ChannelGrid;
  private readonly cursor: Cursor;
  private state: State = 'grid';
  private preview: Preview | null = null;
  private zoom = 0;
  private fade = 0;
  private slotRect: Rect = [0, 0, 0, 0];
  private screen: Screen | null = null;

  constructor(
    private readonly assets: Assets,
    private readonly renderer: Renderer,
    private readonly sound: Sound,
  ) {
    this.grid = new ChannelGrid(assets, renderer, sound);
    this.cursor = new Cursor(assets.menu.cursor);
    this.grid.onSelect = (channel) => this.open(channel);
  }

  private rectFor(screen: Screen, channel: Channel): Rect {
    const { index } = this.grid.locate(channel);
    const [x, y] = center(this.grid.slotPane(index));
    const halfWidth = screen.wide ? 85 : 64;
    return [x - halfWidth, y + 48, x + halfWidth, y - 48];
  }

  private open(channel: Channel): void {
    this.preview = new Preview(this.assets, this.renderer, this.sound, channel);
    this.slotRect = this.rectFor(this.screen!, channel);
    this.grid.footer.setArrows(false, false);
    this.grid.zoomMask(true);
    this.sound.stopMusic(5);
    this.sound.play('WIPL_SE_CH_SELECT');
    this.state = 'zoomIn';
    this.zoom = 0;
  }

  private close(): void {
    const preview = this.preview!;
    const { page } = this.grid.locate(preview.channel);
    this.grid.showPage(page);
    this.slotRect = this.rectFor(this.screen!, preview.channel);
    this.grid.zoomMask(false);
    this.sound.play('WIPL_SE_CH_UNSELECT');
    this.sound.stopBanner(ZOOM_FRAMES);
    this.grid.footer.setArrows(false, false);
    this.state = 'zoomOut';
  }

  /** The Download button must open its link inside the click itself, or browsers block the new tab. */
  linkAt(x: number, y: number): string | null {
    if (this.state !== 'preview' || !this.preview || this.preview.busy) return null;
    return this.preview.hit(x, y) === 'download' ? this.preview.channel.repo : null;
  }

  update(frames: number, pointer: Pointer & { inside: boolean }): void {
    const ready = this.fade >= FADE_FRAMES;
    this.fade = Math.min(FADE_FRAMES, this.fade + frames);
    this.grid.update(frames, pointer, this.state === 'grid' && ready && pointer.inside);
    this.preview?.update(frames);

    if (this.state === 'zoomIn') {
      this.zoom = Math.min(ZOOM_FRAMES, this.zoom + frames);
      if (this.zoom >= ZOOM_FRAMES) {
        this.state = 'preview';
        this.preview!.begin();
        this.grid.footer.setArrows(true, true);
      }
    } else if (this.state === 'zoomOut') {
      this.zoom = Math.max(0, this.zoom - frames);
      if (this.zoom <= 0) {
        this.state = 'grid';
        this.preview = null;
        this.grid.resume();
        this.sound.startMusic();
      }
    } else if (this.state === 'preview') {
      this.updatePreview(pointer);
    }
  }

  private updatePreview(pointer: Pointer & { inside: boolean }): void {
    const preview = this.preview!;
    if (preview.busy || !pointer.inside) {
      preview.release();
      return;
    }
    const footer = this.grid.footer;
    const arrow = footer.hit(pointer.x, pointer.y);
    const side = arrow === 'left' || arrow === 'right' ? arrow : null;
    if (side !== footer.hovered) {
      if (footer.hovered) footer.leave(footer.hovered);
      if (side) footer.point(side);
    }
    preview.point(side ? null : preview.hit(pointer.x, pointer.y));
    if (!pointer.aPressed) return;
    if (side) {
      footer.press(side);
      preview.change(this.grid.neighbor(preview.channel, side === 'left' ? -1 : 1));
    } else if (preview.hovered === 'back') {
      preview.press('back');
      this.close();
    } else if (preview.hovered === 'download') {
      preview.press('download');
    }
  }

  private zoomRect(): Rect {
    const h = ease(this.zoom / ZOOM_FRAMES);
    const half = this.screen!.width / 2;
    const full: Rect = [-half, SCREEN_HEIGHT / 2, half, -SCREEN_HEIGHT / 2];
    return full.map((value, i) => value + (this.slotRect[i] - value) * h) as Rect;
  }

  draw(screen: Screen, pointer: Pointer & { inside: boolean }): void {
    this.screen = screen;
    const renderer = this.renderer;
    if (this.state === 'grid') {
      this.grid.draw(screen);
    } else if (this.state === 'preview') {
      this.preview!.draw(screen);
    } else {
      // The grid zooms toward the slot while the captured preview fades in over it, black around it.
      const [left, top, right, bottom] = this.zoomRect();
      renderer.camera = {
        x: (left + right) / 2,
        y: (top + bottom) / 2,
        scaleX: screen.width / (right - left),
        scaleY: SCREEN_HEIGHT / (top - bottom),
      };
      this.grid.draw(screen);
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
    if (pointer.inside) this.cursor.draw(renderer, screen, pointer.x, pointer.y, false);
    if (this.fade < FADE_FRAMES) {
      const alpha = 255 - Math.floor((this.fade * 255) / FADE_FRAMES);
      const half = screen.width / 2;
      renderer.fill([-half, SCREEN_HEIGHT / 2, half, -SCREEN_HEIGHT / 2], [0, 0, 0, alpha]);
    }
  }
}

