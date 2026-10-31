import { Archive, root } from './assets';
import type { Screen } from './display';
import { AnimationPlayer, identity, type LayoutInstance } from './lyt/layout';
import type { Renderer } from './lyt/renderer';
import type { Texture } from './lyt/tpl';
import { parseU8 } from './lyt/u8';

// The console shows the last line a second after the picture has faded in (HAS_TIMER_FADE_IN).
const LAST_LINE_WAIT = 60;

async function decode(png: Uint8Array): Promise<Texture> {
  const bitmap = await createImageBitmap(new Blob([png.slice()], { type: 'image/png' }), { colorSpaceConversion: 'none' });
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  context.drawImage(bitmap, 0, 0);
  const rgba = new Uint8Array(context.getImageData(0, 0, bitmap.width, bitmap.height).data);
  // As in the console's I4 pictures, a pixel's intensity is its opacity too.
  for (let i = 0; i < rgba.length; i += 4) rgba[i + 3] = rgba[i];
  return { width: bitmap.width, height: bitmap.height, rgba, wrapS: 0, wrapT: 0, minFilter: 1, magFilter: 1 };
}

/** Fetches tools/wii/build_rotate_screen.py's archive: the Health and Safety layout and clips, with PNG pictures. */
export async function loadRotateFiles(renderer: Renderer): Promise<Archive> {
  const response = await fetch(new URL('menu/rotate.u8', root));
  if (!response.ok) throw new Error(`menu/rotate.u8: ${response.status}`);
  const archive = new Archive(parseU8(new Uint8Array(await response.arrayBuffer())));
  // The layout names its pictures as the console's TPLs; screens made from the archive share these textures.
  const instance = archive.instance('it_Has_a');
  for (const [path, png] of archive.files) {
    if (path.endsWith('.png')) {
      renderer.addTexture(instance, path.slice(path.lastIndexOf('/') + 1).replace(/\.png$/, '.tpl'), await decode(png));
    }
  }
  renderer.prepare(instance.layout, archive.files);
  return archive;
}

/**
 * The Health and Safety screen (iplHealth.cpp), asking for the window to be turned sideways. Its text
 * fades in, a second later the last line starts pulsing, and the whole screen fades out when it's left.
 */
export class RotateScreen {
  private readonly instance: LayoutInstance;
  // Bound in this order, so a later clip wins where two share a pane, as on the console.
  private readonly seenIn: AnimationPlayer;
  private readonly pulse: AnimationPlayer;
  private readonly seenOut: AnimationPlayer;
  private waited = 0;
  private pulsing = false;
  private left = false;

  constructor(private readonly renderer: Renderer, archive: Archive) {
    this.instance = archive.instance('it_Has_a');
    // The layout holds every language's pictures; the screen shows one, and the last line only later.
    for (const [name, pane] of this.instance.panes) {
      if (/^(Has|Push)_/.test(name)) pane.visible = name === 'Has_US_ENG';
    }
    const bind = (clip: string, pane: string, loop = false) => (
      new AnimationPlayer(archive.animation(`it_Has_a_${clip}`)!, this.instance, { panes: [pane], recursive: true, loop })
    );
    this.seenIn = bind('SeenIn', 'N_All');
    this.pulse = bind('Push', 'N_Push', true);
    this.seenOut = bind('SeenOut', 'N_All');
    // The console starts a clip and calculates in one update, so the first frame drawn is already one in.
    this.seenIn.play().step(1);
  }

  update(frames: number): void {
    for (const clip of [this.seenIn, this.pulse, this.seenOut]) clip.step(frames);
    if (this.pulsing || this.seenIn.playing) return;
    this.waited += frames;
    if (this.waited > LAST_LINE_WAIT) {
      this.instance.pane('Push_US_ENG').visible = true;
      this.pulse.play().step(frames);
      this.pulsing = true;
    }
  }

  /** The window is sideways again: the screen fades out as it does once A is pressed (one still fading in just goes). */
  leave(): void {
    this.left = true;
    if (!this.seenIn.playing) this.seenOut.play().step(1);
  }

  get leaving(): boolean {
    return this.left;
  }

  /** Faded out, with nothing left to see. */
  get done(): boolean {
    return this.left && !this.seenOut.playing;
  }

  draw(screen: Screen): void {
    this.instance.update(identity(), screen);
    this.renderer.drawLayout(this.instance);
  }
}
