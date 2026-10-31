import { loadAssets, root } from './assets';
import { measureScreen, SCREEN_HEIGHT, toScreen, type Screen } from './display';
import { Renderer } from './lyt/renderer';
import type { MenuPointer } from './menu';
import { Scenes } from './scenes';
import { Sound } from './sound';

const canvas = document.querySelector<HTMLCanvasElement>('#screen')!;
const links = document.querySelector<HTMLElement>('#channel-links')!;
const notice = document.querySelector<HTMLElement>('#notice')!;
// The channels as plain links: for screen readers, and the whole page if WebGL is missing.
void fetch(new URL('channels.json', root)).then((r) => (r.ok ? r.json() : [])).catch(() => []).then((list: { name: string; repo: string }[]) => {
  for (const channel of list) {
    const link = document.createElement('a');
    link.href = channel.repo;
    link.textContent = channel.name || 'Empty Slot';
    links.append(link);
  }
});
/** When the menu can't run here, the channel links become the page, saying why. */
function fallBack(message: string): void {
  if (!canvas.isConnected) return;
  canvas.remove();
  links.className = 'fallback';
  links.prepend(Object.assign(document.createElement('p'), { textContent: `${message} Here are my forwarder channels:` }));
}

// A black screen tells a visitor nothing, so a failure names its first line instead.
function stop(error: unknown): void {
  const reason = error instanceof Error ? error.message.split('\n')[0] : String(error);
  fallBack(`This Wii Menu stopped on this device (${reason}).`);
}

let renderer: Renderer;
try {
  renderer = new Renderer(canvas);
} catch {
  fallBack('This Wii Menu needs WebGL 2.');
  throw new Error('WebGL 2 is unavailable');
}
canvas.addEventListener('webglcontextlost', () => stop(new Error('the graphics context was lost')));
const sound = new Sound();
const scenes = new Scenes(renderer, sound);
// The loop runs while the files load, so a phone held upright is asked to turn it at once.
void loadAssets(renderer).then((assets) => {
  scenes.start(assets, screen.portrait);
  // The previews' banners get ready in the background, so opening or switching one never pauses.
  renderer.prepare(assets.menu.chanTtl.layout('my_ChTop_a'), assets.menu.chanTtl.files);
  for (const channel of assets.channels) renderer.prepare(channel.banner.layout('banner'), channel.banner.files);
}).catch(stop);

const pointer: MenuPointer = {
  x: 0, y: 0, a: false, b: false, aPressed: false, bPressed: false, sincePress: null, inside: false,
};
let screen: Screen = measureScreen(canvas);
let pressed = false;
let pressedB = false;

function track(event: PointerEvent) {
  [pointer.x, pointer.y] = toScreen(screen, canvas, event.clientX, event.clientY);
  // Past the TV's edges the hand is gone, as when a Wii Remote points away, so the system cursor returns.
  pointer.inside = !scenes.rotating && Math.abs(pointer.x) <= screen.width / 2 && Math.abs(pointer.y) <= SCREEN_HEIGHT / 2;
  canvas.style.cursor = pointer.inside ? 'none' : 'auto';
}
canvas.addEventListener('pointermove', track);
canvas.addEventListener('pointerleave', () => (pointer.inside = false));
canvas.addEventListener('pointerdown', (event) => {
  sound.unlock();
  if (scenes.rotating) scenes.continueUpright();
  track(event);
  canvas.setPointerCapture(event.pointerId);
  if (event.button === 0) {
    pointer.a = true;
    pressed = true;
    const link = scenes.linkAt(pointer.x, pointer.y);
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
// A button released while the page can't see it (another window took focus) must not stay held.
const releaseAll = () => (pointer.a = pointer.b = false);
canvas.addEventListener('lostpointercapture', releaseAll);
window.addEventListener('blur', releaseAll);
canvas.addEventListener('wheel', (event) => {
  event.preventDefault();
  scenes.wheel(event.deltaY * (SCREEN_HEIGHT / screen.viewport[3]) * devicePixelRatio);
}, { passive: false });
// Holding the right button is holding B, so the browser's own menu stays out of the way.
canvas.addEventListener('contextmenu', (event) => event.preventDefault());

const debug = { capture: false, png: '', scenes, get menu() { return scenes.menu; }, renderer, pointer, sound };
let last = performance.now();
function frame(now: number) {
  try {
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
    scenes.update(frames, pointer, screen.portrait);
    sound.endUpdate();

    renderer.beginFrame([screen.width, SCREEN_HEIGHT], screen.viewport);
    scenes.draw(screen, pointer);
    renderer.settle();
    if (notice.textContent !== scenes.notice) notice.textContent = scenes.notice;
    if (import.meta.env.DEV && debug.capture) {
      debug.png = canvas.toDataURL('image/png');
      debug.capture = false;
    }
  } catch (error) {
    stop(error);
    return;
  }
  requestAnimationFrame(frame);
}
if (import.meta.env.DEV) (window as unknown as { __menu: typeof debug }).__menu = debug;
requestAnimationFrame(frame);
