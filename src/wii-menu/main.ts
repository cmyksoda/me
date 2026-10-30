import { loadAssets } from './assets';
import { Cursor } from './cursor';
import { measureScreen, SCREEN_HEIGHT, toScreen, type Screen } from './display';
import { ChannelGrid, type Pointer } from './grid';
import { Renderer } from './lyt/renderer';
import { Sound } from './sound';

const FADE_FRAMES = 20;

const canvas = document.querySelector<HTMLCanvasElement>('#screen')!;
const renderer = new Renderer(canvas);
const sound = new Sound();
const assets = await loadAssets(renderer);
const grid = new ChannelGrid(assets, renderer, sound);
const cursor = new Cursor(assets.menu.cursor);
grid.footer.setSoundLabel(sound.enabled);

const links = document.querySelector('#channel-links')!;
for (const channel of assets.channels) {
  const link = document.createElement('a');
  link.href = channel.repo;
  link.textContent = channel.name || 'Empty Slot';
  links.append(link);
}

const pointer: Pointer & { inside: boolean } = {
  x: 0, y: 0, a: false, b: false, aPressed: false, sincePress: null, inside: false,
};
let screen: Screen = measureScreen(canvas);
let pressedThisFrame = false;

function track(event: PointerEvent) {
  [pointer.x, pointer.y] = toScreen(screen, canvas, event.clientX, event.clientY);
  pointer.inside = true;
}
canvas.addEventListener('pointermove', track);
canvas.addEventListener('pointerleave', () => (pointer.inside = false));
canvas.addEventListener('pointerdown', (event) => {
  track(event);
  canvas.setPointerCapture(event.pointerId);
  if (event.button === 0) {
    pointer.a = true;
    pressedThisFrame = true;
  } else if (event.button === 2) {
    pointer.b = true;
    pointer.sincePress = null;
  }
});
canvas.addEventListener('pointerup', (event) => {
  if (event.button === 0) pointer.a = false;
  else if (event.button === 2) pointer.b = false;
});
// Holding the right button is holding B, so the browser's own menu stays out of the way.
canvas.addEventListener('contextmenu', (event) => event.preventDefault());

grid.onOptions = () => {
  sound.enabled = !sound.enabled;
  grid.footer.setSoundLabel(sound.enabled);
};

let fade = 0;
let last = performance.now();
function frame(now: number) {
  // The menu runs at 60 updates per second whatever the display's refresh rate.
  const frames = Math.min(10, (now - last) * 0.06);
  last = now;
  screen = measureScreen(canvas);

  pointer.aPressed = pressedThisFrame;
  if (pressedThisFrame) pointer.sincePress = 0;
  else if (pointer.sincePress !== null) pointer.sincePress += frames;
  pressedThisFrame = false;
  grid.update(frames, pointer, fade >= FADE_FRAMES && pointer.inside);

  renderer.beginFrame([screen.width, SCREEN_HEIGHT], screen.viewport);
  grid.draw(screen);
  if (pointer.inside) cursor.draw(renderer, screen, pointer.x, pointer.y, false);
  // EGG::ColorFader: black fades out over 20 updates once the menu is ready.
  if (fade < FADE_FRAMES) {
    fade = Math.min(FADE_FRAMES, fade + frames);
    const alpha = 255 - Math.floor((fade * 255) / FADE_FRAMES);
    renderer.fill([-screen.width / 2, SCREEN_HEIGHT / 2, screen.width / 2, -SCREEN_HEIGHT / 2], [0, 0, 0, alpha]);
  }

  if (import.meta.env.DEV && debug.capture) {
    debug.png = canvas.toDataURL('image/png');
    debug.capture = false;
  }
  requestAnimationFrame(frame);
}
const debug = { capture: false, png: '', grid, renderer, pointer };
if (import.meta.env.DEV) (window as unknown as { __menu: typeof debug }).__menu = debug;
requestAnimationFrame(frame);
