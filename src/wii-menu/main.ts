import { loadAssets, root } from './assets';
import { measureScreen, SCREEN_HEIGHT, toScreen, type Screen } from './display';
import { Renderer } from './lyt/renderer';
import type { MenuPointer } from './menu';
import { Scenes } from './scenes';
import { Sound } from './sound';

const canvas = document.querySelector<HTMLCanvasElement>('#screen')!;
const links = document.querySelector<HTMLElement>('#channel-links')!;
const notice = document.querySelector<HTMLElement>('#notice')!;
// Set by the page's inline script when the address has ?debug.
const diagnostics = (window as {
  __debug?: { log: (line: string) => void; status: (text: string) => void; append: (node: Node) => void };
}).__debug;
diagnostics?.log('module running');
// The channels as plain links: for screen readers, and the whole page if WebGL is missing.
void fetch(new URL('channels.json', root))
  .then((r) => (r.ok ? r.json() : []))
  .catch(() => [])
  .then((list: { name: string; repo: string }[]) => {
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
  links.prepend(
    Object.assign(document.createElement('p'), { textContent: `${message} Here are my forwarder channels:` }),
  );
}

// A black screen tells a visitor nothing, so a failure names its first line instead.
function stop(error: unknown): void {
  const reason = error instanceof Error ? error.message.split('\n')[0] : String(error);
  diagnostics?.log(`stopped: ${error instanceof Error ? error.stack ?? error.message : reason}`);
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
if (diagnostics) {
  const info = renderer.gl.getExtension('WEBGL_debug_renderer_info');
  diagnostics.log(`gpu: ${renderer.gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : renderer.gl.RENDERER)}`);
  void import('./gl-test').then(({ testGraphics, visibleCanvases }) => {
    diagnostics.append(visibleCanvases());
    return testGraphics();
  }).then((lines) => lines.forEach(diagnostics.log));
}
const sound = new Sound();
const scenes = new Scenes(renderer, sound);
// The loop runs while the files load, so a phone held upright is asked to turn it at once.
void loadAssets(renderer).then((assets) => {
  diagnostics?.log('files loaded');
  scenes.start(assets, screen.portrait);
  // The previews' banners get ready in the background, so opening or switching one never pauses.
  renderer.prepare(assets.menu.chanTtl.layout('my_ChTop_a'), assets.menu.chanTtl.files);
  for (const channel of assets.channels) renderer.prepare(channel.banner.layout('banner'), channel.banner.files);
}).catch(stop);

const pointer: MenuPointer = {
  x: 0, y: 0, a: false, b: false, aPressed: false, bPressed: false, sincePress: null, inside: false, touch: false,
};
let screen: Screen = measureScreen(canvas);
let pressed = false;
let pressedB = false;
let frameCount = 0;

function track(event: PointerEvent) {
  [pointer.x, pointer.y] = toScreen(screen, canvas, event.clientX, event.clientY);
  pointer.touch = event.pointerType === 'touch';
  // Past the TV's edges the hand is gone, as when a Wii Remote points away, so the system cursor returns.
  pointer.inside =
    !scenes.rotating && Math.abs(pointer.x) <= screen.window / 2 && Math.abs(pointer.y) <= SCREEN_HEIGHT / 2;
  canvas.style.cursor = pointer.inside ? 'none' : 'auto';
}
canvas.addEventListener('pointermove', track);
// A lifted finger keeps pointing until its tap is decided (the fifth update after the press), or a quick tap
// on a channel would be forgotten before it could open.
const TAP_DECIDED = 6;
let fingerLifted = false;
canvas.addEventListener('pointerleave', (event) => {
  if (event.pointerType === 'touch') fingerLifted = true;
  else pointer.inside = false;
});
canvas.addEventListener('pointerdown', (event) => {
  fingerLifted = false;
  sound.unlock();
  if (scenes.rotating) scenes.continueUpright();
  track(event);
  canvas.setPointerCapture(event.pointerId);
  if (event.button === 0) {
    pointer.a = true;
    pressed = true;
    tapFrom = [event.clientX, event.clientY];
    if (!pointer.touch) openLink();
  } else if (event.button === 2) {
    pointer.b = true;
    pressedB = true;
    pointer.sincePress = null;
  }
});
canvas.addEventListener('pointerup', (event) => {
  if (event.button === 0) pointer.a = false;
  else if (event.button === 2) pointer.b = false;
  // A finger may be starting a drag, so it opens a link only when it lifts where it went down.
  if (event.pointerType === 'touch' && Math.hypot(event.clientX - tapFrom[0], event.clientY - tapFrom[1]) < 10)
    openLink();
});
let tapFrom: [number, number] = [0, 0];
/** Links open inside the click or tap itself, or browsers block the new tab. */
function openLink(): void {
  const link = scenes.linkAt(pointer.x, pointer.y);
  if (link) window.open(link, '_blank', 'noopener');
}
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
    if (fingerLifted && (pointer.sincePress === null || pointer.sincePress >= TAP_DECIDED)) {
      fingerLifted = false;
      pointer.inside = false;
    }

    renderer.beginFrame([screen.window, SCREEN_HEIGHT], screen.viewport);
    scenes.draw(screen, pointer);
    renderer.settle();
    if (notice.textContent !== scenes.notice) notice.textContent = scenes.notice;
    if (diagnostics && ++frameCount % 30 === 1) {
      const gl = renderer.gl;
      // What the menu really drew in the middle of its picture, before the page shows it.
      const [x, y, w, h] = screen.viewport;
      const middle = new Uint8Array(4);
      gl.readPixels(Math.floor(x + w / 2), Math.floor(y + h / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, middle);
      diagnostics.status(`frame ${frameCount}  drawn middle ${[...middle].join(',')}
css ${canvas.clientWidth}x${canvas.clientHeight}  canvas ${canvas.width}x${canvas.height}  dpr ${devicePixelRatio}
viewport ${screen.viewport.join(' ')}  units ${Math.round(screen.window)}  portrait ${screen.portrait}
menu ${!!scenes.menu}  sd ${!!scenes.sd}  rotating ${scenes.rotating}  gl error 0x${gl.getError().toString(16)}  lost ${gl.isContextLost()}`);
    }
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
