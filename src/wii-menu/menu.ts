import type { Assets, Channel } from './assets';
import { Board } from './board';
import { Cursor } from './cursor';
import { perMode, SCREEN_HEIGHT, type Screen } from './display';
import type { FooterTarget } from './footer';
import { ChannelGrid, type Pointer } from './grid';
import { letters } from './letters';
import { center } from './lyt/hit';
import type { Rect, Renderer } from './lyt/renderer';
import { Preview } from './preview';
import type { Sound } from './sound';

const ZOOM_FRAMES = 28;
const FADE_FRAMES = 20;
// The banner loads before the zoom starts: WIPL_SE_CH_SELECT comes 4 to 12 updates after the click.
const ZOOM_WAIT = 12;
const READ_KEY = 'wii-forwarders.read';

type State = 'grid' | 'opening' | 'zoomIn' | 'preview' | 'zoomOut' | 'board';

export type MenuPointer = Pointer & { inside: boolean };

/** Smoothstep, as the menu's zero-tangent HermiteIntp. */
const ease = (t: number) => t * t * (3 - 2 * t);

/** Runs the scenes the way the menu's scene tree does: the board under the grid, the zoom, the preview. */
export class Menu {
  readonly grid: ChannelGrid;
  readonly board: Board;
  private readonly cursor: Cursor;
  private state: State = 'grid';
  private preview: Preview | null = null;
  private zoom = 0;
  private wait = 0;
  private fade = 0;
  private slotRect: Rect = [0, 0, 0, 0];
  private screen: Screen | null = null;

  constructor(private readonly assets: Assets, private readonly renderer: Renderer, private readonly sound: Sound) {
    this.grid = new ChannelGrid(assets, renderer, sound);
    this.board = new Board(assets, renderer, sound, letters);
    this.cursor = new Cursor(assets.menu.cursor);
    this.grid.onSelect = (channel) => this.open(channel);
    this.grid.onBoard = () => this.openBoard();
    this.board.onOpened = () => this.grid.footer.openLetter();
    let read = false;
    try {
      read = localStorage.getItem(READ_KEY) === '1';
    } catch {}
    this.grid.footer.setMail(this.board.letterCount, !read);
  }

  private rectFor(channel: Channel): Rect {
    const { index } = this.grid.locate(channel);
    const [x, y] = center(this.grid.slotPane(index));
    const halfWidth = perMode(this.screen!, 64, 85);
    return [x - halfWidth, y + 48, x + halfWidth, y - 48];
  }

  private open(channel: Channel): void {
    this.preview = new Preview(this.assets, this.renderer, this.sound, channel);
    this.slotRect = this.rectFor(channel);
    this.grid.footer.setArrows(false, false);
    this.sound.stopMusic(5);
    this.state = 'opening';
    this.wait = ZOOM_WAIT;
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

  private openBoard(): void {
    this.state = 'board';
    this.grid.footer.enterBoard();
    this.grid.footer.stopNewMail();
    this.grid.slideAway();
    this.board.show();
    try {
      localStorage.setItem(READ_KEY, '1');
    } catch {}
  }

  private closeBoard(): void {
    this.board.hide();
    this.grid.footer.leaveBoard();
    this.grid.footer.setMail(this.board.letterCount, false);
    this.grid.slideBack();
    this.state = 'grid';
  }

  /** The Download button must open its link inside the click itself, or browsers block the new tab. */
  linkAt(x: number, y: number): string | null {
    if (this.state === 'board') return this.board.linkAt(x, y);
    if (this.state !== 'preview' || !this.preview || this.preview.busy) return null;
    return this.preview.hit(x, y) === 'download' ? this.preview.channel.repo : null;
  }

  wheel(delta: number): void {
    this.board.wheel(delta);
  }

  update(frames: number, pointer: MenuPointer): void {
    const ready = this.fade >= FADE_FRAMES;
    this.fade = Math.min(FADE_FRAMES, this.fade + frames);
    const live = ready && pointer.inside;
    this.grid.update(frames, pointer, this.state === 'grid' && live);
    this.board.update(frames, pointer, this.state === 'board' && live, this.screen!);
    this.preview?.update(frames);
    if (ready && !pointer.inside) {
      if (this.state === 'grid') this.grid.pointAway();
      if (this.state === 'board') {
        this.board.pointAway();
        if (this.grid.footer.hovered) this.grid.footer.leave(this.grid.footer.hovered);
      }
    }

    if (this.state === 'opening') {
      this.wait -= frames;
      if (this.wait <= 0) {
        this.grid.zoomMask(true);
        this.sound.play('WIPL_SE_CH_SELECT');
        this.state = 'zoomIn';
        this.zoom = 0;
      }
    } else if (this.state === 'zoomIn') {
      this.zoom = Math.min(ZOOM_FRAMES, this.zoom + frames);
      if (this.zoom >= ZOOM_FRAMES) {
        this.state = 'preview';
        // The banner sound lands 0.48 s after WIPL_SE_CH_SELECT, one update after the zoom.
        this.preview!.begin(1);
        this.grid.footer.setArrows(true, true);
      }
    } else if (this.state === 'zoomOut') {
      this.zoom = Math.max(0, this.zoom - frames);
      if (this.zoom <= 0) {
        this.state = 'grid';
        this.preview = null;
        this.grid.resume();
        // The music starts over 0.5 s after Back was pressed, two updates after the zoom.
        this.sound.startMusic(2);
      }
    } else if (this.state === 'preview') {
      this.updatePreview(pointer);
    } else if (this.state === 'board' && live) {
      this.updateBoardFooter(pointer);
    }
  }

  private updateBoardFooter(pointer: MenuPointer): void {
    const footer = this.grid.footer;
    if (this.board.bScrolling || this.board.pinching) return;
    const target = this.board.state === 'normal' || this.board.state === 'reading' ? footer.hit(pointer.x, pointer.y) : null;
    if (target !== footer.hovered) {
      if (footer.hovered) footer.leave(footer.hovered);
      if (target) footer.point(target);
    }
    if (!pointer.aPressed || !target) return;
    this.pressBoardButton(target);
  }

  private pressBoardButton(target: FooterTarget): void {
    const footer = this.grid.footer;
    if (target === 'menu') {
      this.sound.play('WIPL_SE_DECIDE');
      this.closeBoard();
    } else if (target === 'back') {
      this.board.closeLetter();
      footer.closeLetter();
    } else {
      // Calendar, Create Message and Trash belong to scenes this page doesn't have.
      this.sound.play('WIPL_SE_GRAY_BUTTON');
    }
  }

  private updatePreview(pointer: MenuPointer): void {
    const preview = this.preview!;
    const footer = this.grid.footer;
    if (preview.busy || !pointer.inside) {
      preview.release();
      if (!pointer.inside && footer.hovered) footer.leave(footer.hovered);
      return;
    }
    const side = footer.hitArrow(pointer.x, pointer.y);
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
    // The zoom starts from the console's picture, which a window wider than 16:9 shows in its middle.
    const half = this.screen!.projection / 2;
    const full: Rect = [-half, SCREEN_HEIGHT / 2, half, -SCREEN_HEIGHT / 2];
    return full.map((value, i) => value + (this.slotRect[i] - value) * h) as Rect;
  }

  draw(screen: Screen, pointer: MenuPointer): void {
    this.screen = screen;
    const renderer = this.renderer;
    const zooming = this.state === 'zoomIn' || this.state === 'zoomOut';
    if (zooming) {
      // setOrthoTransAndScale: the camera frames the rectangle shrinking toward the chosen slot.
      const [left, top, right, bottom] = this.zoomRect();
      renderer.camera = {
        x: (left + right) / 2,
        y: (top + bottom) / 2,
        scaleX: screen.projection / (right - left),
        scaleY: SCREEN_HEIGHT / (top - bottom),
      };
    }
    if (this.state === 'preview') {
      this.preview!.draw(screen);
    } else {
      // Board, then the footer's Button scene, then the grid over both.
      this.board.draw(screen);
      this.grid.footer.drawPods(screen);
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
      renderer.drawCapture(this.slotRect, alpha, screen.projection / screen.width);
      renderer.camera = null;
    }
    // On a window wider than 16:9 the preview's arrows stay on its 16:9 picture, which hides them past its edges as a TV's would.
    const onPicture = (this.state === 'preview' || this.state === 'zoomOut') && screen.width > screen.projection;
    if (onPicture) renderer.setClip([-screen.projection / 2, SCREEN_HEIGHT / 2, screen.projection / 2, -SCREEN_HEIGHT / 2]);
    this.grid.footer.drawArrows(onPicture ? { ...screen, width: screen.projection } : screen);
    if (onPicture) renderer.setClip(null);
    // The B-scroll marker stays where B went down, even with the hand off the TV.
    if (this.board.bScrolling) this.board.drawCursor(screen);
    else if (pointer.inside) this.cursor.draw(renderer, screen, pointer.x, pointer.y, this.grid.grabbing || this.board.pinching);
    if (this.fade < FADE_FRAMES) {
      const alpha = 255 - Math.floor((this.fade * 255) / FADE_FRAMES);
      const half = screen.width / 2;
      renderer.fill([-half, SCREEN_HEIGHT / 2, half, -SCREEN_HEIGHT / 2], [0, 0, 0, alpha]);
    }
  }
}
