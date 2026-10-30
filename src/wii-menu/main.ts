import { loadAssets } from './assets';
import { measureScreen, SCREEN_HEIGHT, toScreen, type Screen } from './display';
import { Renderer } from './lyt/renderer';
import { Menu, type MenuPointer } from './menu';
import { Sound } from './sound';

const canvas = document.querySelector<HTMLCanvasElement>('#screen')!;
const renderer = new Renderer(canvas);
const sound = new Sound();
const assets = await loadAssets(renderer);
const menu = new Menu(assets, renderer, sound);
menu.grid.footer.setSoundLabel(sound.enabled);
menu.grid.onOptions = () => {
  sound.setEnabled(!sound.enabled);
  menu.grid.footer.setSoundLabel(sound.enabled);
};

const links = document.querySelector('#channel-links')!;
for (const channel of assets.channels) {
  const link = document.createElement('a');
  link.href = channel.repo;
  link.textContent = channel.name || 'Empty Slot';
  links.append(link);
}

const pointer: MenuPointer = {
  x: 0, y: 0, a: false, b: false, aPressed: false, bPressed: false, sincePress: null, inside: false,
};
let screen: Screen = measureScreen(canvas);
let pressed = false;
let pressedB = false;

function track(event: PointerEvent) {
  [pointer.x, pointer.y] = toScreen(screen, canvas, event.clientX, event.clientY);
  pointer.inside = true;
}
canvas.addEventListener('pointermove', track);
canvas.addEventListener('pointerleave', () => (pointer.inside = false));
canvas.addEventListener('pointerdown', (event) => {
  sound.unlock();
  track(event);
  canvas.setPointerCapture(event.pointerId);
  if (event.button === 0) {
    pointer.a = true;
    pressed = true;
    const link = menu.linkAt(pointer.x, pointer.y);
    if (link) window.open(link, '_blank', 'noopener');
  } else if (event.button === 2) {
    pointer.b = true;
    pressedB = true;
    pointer.sincePress = null;
  }
});
canvas.addEventListener('pointerup', (event) => {
  if (event.button === 0) pointer.a = false;
  else if (event.button === 2) pointer.b = false;
});
canvas.addEventListener('wheel', (event) => {
  event.preventDefault();
  menu.wheel(event.deltaY * (SCREEN_HEIGHT / screen.viewport[3]) * devicePixelRatio);
}, { passive: false });
// Holding the right button is holding B, so the browser's own menu stays out of the way.
canvas.addEventListener('contextmenu', (event) => event.preventDefault());

const debug = { capture: false, png: '', menu, renderer, pointer, sound };
let last = performance.now();
function frame(now: number) {
  // The menu runs at 60 updates per second whatever the display's refresh rate.
  const frames = Math.min(10, (now - last) * 0.06);
  last = now;
  screen = measureScreen(canvas);

  pointer.aPressed = pressed;
  pointer.bPressed = pressedB;
  pressedB = false;
  if (pressed) pointer.sincePress = 0;
  else if (pointer.sincePress !== null) pointer.sincePress += frames;
  pressed = false;
  menu.update(frames, pointer);

  renderer.beginFrame([screen.width, SCREEN_HEIGHT], screen.viewport);
  menu.draw(screen, pointer);
  if (import.meta.env.DEV && debug.capture) {
    debug.png = canvas.toDataURL('image/png');
    debug.capture = false;
  }
  requestAnimationFrame(frame);
}
if (import.meta.env.DEV) (window as unknown as { __menu: typeof debug }).__menu = debug;
requestAnimationFrame(frame);
