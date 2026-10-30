// The Homebrew Channel 1.1.3, its main loop ported from main.c with one generator step per frame.

import { apps, loadApps, type App } from './apps';
import { browser, browserGenView, browserInit, browserRelayout, browserSelection, browserSetFocus, browserSwitchMode, INFO, LAN, VIEW_MODE } from './browser';
import { A, B, DOWN, DPAD, LEFT, listen, MINUS, PLUS, RIGHT, TWO, UP } from './controls';
import { DIALOG_MASK_COLOR, dialogAbout, dialogApp, dialogFade } from './dialogs';
import { lineSpacing } from './font';
import { prefersWide, screen, setWidescreen } from './gfx';
import { loadTheme } from './theme';
import { enableCursor, focusNext, focusPrevious, plot, pointing, render, showThrobber, tickleThrobber, viewFade, widgetAtPointer, type View } from './view';
import { ENABLED, scrollMemo, scrollMemoDeco, setFlag } from './widgets';

const FRAME = 1000 / 60;
// Stand-ins for the Wii's own waits: reading the SD card's apps, and bringing up the network.
const SD_LOAD_FRAMES = 30;
const NET_INIT_MS = 3000;

// The network icon blinks while wiiload's network comes up, then stays lit if the browser is online.
let netStart = performance.now();
const tcpInitializing = () => performance.now() - netStart < NET_INIT_MS;
const tcpInitialized = () => !tcpInitializing() && navigator.onLine;

function tcpInit() {
  if (!tcpInitializing() && !tcpInitialized()) netStart = performance.now();
}

function openSource(app: App) {
  open(app.source, '_blank', 'noopener');
}

function download(app: App) {
  if (!app.download) return;
  const link = document.createElement('a');
  link.href = app.download;
  link.download = '';
  link.click();
}

function* channel(): Generator<void, void, void> {
  yield* viewFade(browser, 0x000000ff, 31, -8);
  enableCursor(true);

  const lineHeight = lineSpacing('memo');
  let current: View = browser;
  let last: View = browser;
  let detail: View | null = null;
  let about: View | null = null;
  let app: App | null = null;
  let frame = 0;
  let loadFrames = -1;
  let loading = false;

  while (true) {
    if (current === browser && loadFrames === 0) {
      loadFrames = -2;
      showThrobber(false);
      yield* browserGenView('add');
    }

    if (loading !== loadFrames > 0) {
      loading = loadFrames > 0;
      showThrobber(loading);
    }
    if (loading) {
      tickleThrobber();
      loadFrames--;
    }
    if (frame % 30 === 0 && loadFrames === -1) loadFrames = SD_LOAD_FRAMES;

    if (current === browser && prefersWide() !== screen.wide) {
      setWidescreen(!screen.wide);
      browserRelayout();
    }

    const pad = yield* plot(current, DIALOG_MASK_COLOR);
    frame++;
    if (last !== current) {
      frame = 0;
      last = current;
    }

    if (current === browser) {
      const lan = browser.widgets[LAN]!;
      if (!tcpInitializing()) setFlag(lan, ENABLED, tcpInitialized());
      if (tcpInitializing() && frame % 20 === 0) setFlag(lan, ENABLED, !(lan.flags & ENABLED));

      if (pad.down & TWO) {
        yield* browserSwitchMode();
        continue;
      }
      if (pad.down & DPAD) {
        browserSetFocus(pad.down);
        continue;
      }
      if (pad.down & A) {
        const clicked = widgetAtPointer(browser);
        if (clicked === 0) yield* browserGenView('previous');
        else if (clicked === 1) yield* browserGenView('next');
        else if (clicked === LAN) tcpInit();
        else if (clicked === VIEW_MODE) yield* browserSwitchMode();
        else if (clicked === INFO) {
          about = dialogAbout(browser);
          current = about;
          enableCursor(false);
          yield* dialogFade(about, true);
        } else {
          app = browserSelection();
          if (app) {
            detail = dialogApp(app, browser);
            current = detail;
            yield* dialogFade(detail, true);
          }
        }
        continue;
      }
      if ((pad.down | pad.held) & MINUS) yield* browserGenView('previous');
      if ((pad.down | pad.held) & PLUS) yield* browserGenView('next');
      continue;
    }

    if (current === detail && app) {
      if (pad.down & LEFT) focusPrevious(detail);
      if (pad.down & RIGHT) focusNext(detail);

      let scroll = 0;
      if (pad.down & UP) scroll += lineHeight;
      if (pad.down & DOWN) scroll -= lineHeight;

      // Held B on a long description pulls it along like a joystick. B anywhere else
      // backs out, and so does a click outside the dialog.
      const dragging = detail.drag && detail.dragWidget === 6;
      const clickedOutside = (pad.down & A) !== 0 && pointing() && widgetAtPointer(detail) === -1;
      if (dragging) scroll += Math.trunc(-detail.dragY / 32);
      let close = !dragging && ((pad.down & B) !== 0 || clickedOutside);

      if (!close) {
        scrollMemoDeco(detail.widgets.slice(5, 8), scroll);
        if (pad.down & A) {
          if (detail.focus === 8) openSource(app);
          if (detail.focus === 9) download(app);
          close = detail.focus >= 8;
        }
      }
      if (close) {
        yield* dialogFade(detail, false);
        current = browser;
        detail = null;
      }
      continue;
    }

    if (current === about) {
      if (pad.down & (A | B)) {
        yield* dialogFade(about, false);
        current = browser;
        about = null;
        enableCursor(true);
        continue;
      }
      if (frame > 60 * 2 && frame % 3 === 0) scrollMemo(about.widgets[2]!, -1);
    }
  }
}

async function start() {
  const canvas = document.querySelector<HTMLCanvasElement>('#tv')!;
  await loadTheme();
  loadApps();
  setWidescreen(prefersWide());
  browserInit();
  listen(canvas);
  canvas.setAttribute('aria-label', `The Homebrew Channel, listing ${apps.map((entry) => entry.name).join(', ')}`);

  const steps = channel();
  let last = performance.now();
  let behind = 0;
  const tick = (now: number) => {
    // A frame late is caught up; a hidden tab doesn't fast-forward when it returns.
    behind = Math.min(behind + now - last, FRAME * 4);
    last = now;
    let stepped = false;
    while (behind >= FRAME - 2) {
      steps.next();
      behind -= FRAME;
      stepped = true;
    }
    if (stepped) render();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

start();
