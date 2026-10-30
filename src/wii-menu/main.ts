import { loadAssets, root } from './assets';
import { measureScreen, SCREEN_HEIGHT, toScreen, type Screen } from './display';
import { Renderer } from './lyt/renderer';
import { Menu, type MenuPointer } from './menu';
import { Sound } from './sound';

const canvas = document.querySelector<HTMLCanvasElement>('#screen')!;
const links = document.querySelector<HTMLElement>('#channel-links')!;
// The channels as plain links: for screen readers, and the whole page if WebGL is missing.
void fetch(new URL('channels.json', root)).then((r) => (r.ok ? r.json() : [])).catch(() => []).then((list: { name: string; repo: string }[]) => {
  for (const channel of list) {
    const link = document.createElement('a');
    link.href = channel.repo;
    link.textContent = channel.name || 'Empty Slot';
    links.append(link);
  }
});
let renderer: Renderer;
try {
  renderer = new Renderer(canvas);
} catch {
  // Without WebGL 2 the menu can't be drawn, so the channel links become the page.
  canvas.remove();
  links.className = 'fallback';
  links.prepend(Object.assign(document.createElement('p'), { textContent: 'This Wii Menu needs WebGL 2. Here are my forwarder channels:' }));
  throw new Error('WebGL 2 is unavailable');
}
const sound = new Sound();
const assets = await loadAssets(renderer);
const menu = new Menu(assets, renderer, sound);
menu.grid.footer.setSoundLabel(sound.enabled);
menu.grid.onOptions = () => {
  sound.setEnabled(!sound.enabled);
  menu.grid.footer.setSoundLabel(sound.enabled);
};


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
