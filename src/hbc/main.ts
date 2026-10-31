// The Homebrew Channel 1.1.3, its main loop ported from main.c with one generator step per frame.

import { apps, loadApps, type App } from './apps';
import { browser, browserGenView, browserInit, browserRelayout, browserSelection, browserSetFocus, browserSwitchMode, INFO, VIEW_MODE } from './browser';
import { A, B, DOWN, DPAD, LEFT, listen, MINUS, PLUS, RIGHT, TWO, UP } from './controls';
import { aboutStep, DIALOG_MASK_COLOR, dialogAbout, dialogApp, dialogFade, dialogX, restingY, SOURCE_URL } from './dialogs';
import { lineSpacing } from './font';
import { screen, setLayout, windowLayout } from './gfx';
import { loadTheme } from './theme';
import { enableCursor, focusNext, focusPrevious, grabButtonAt, plot, pointing, render, showThrobber, tickleThrobber, viewFade, widgetAtPointer, type View } from './view';
import { scrollMemoDeco } from './widgets';

const FRAME = 1000 / 60;
// A stand-in for the Wii's wait while it reads the SD card's apps.
const SD_LOAD_FRAMES = 30;

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
  // Where a long description's text sat when B grabbed it.
  let grabbedAt: number | null = null;
  let about: View | null = null;
  let app: App | null = null;
  let frame = 0;
  let loadFrames = -1;
  let loading = false;

  // The tall layout's cards are built to the view's size, so a new size builds them again, where they were.
  const rebuildDialogs = () => {
    grabbedAt = null;
    if (detail && app) {
      const text = detail.widgets[6]!;
      const scrolled = text.memo!.yMax - text.y;
      detail = dialogApp(app, browser);
      detail.y = restingY(detail.y);
      scrollMemoDeco(detail.widgets.slice(5, 8), -scrolled);
      current = detail;
    }
    if (about) {
      about = dialogAbout(browser);
      about.y = restingY(about.y);
      current = about;
    }
  };

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

    // A dialog keeps its text as laid out until it closes, so only the width follows while one is open.
    const layout = windowLayout();
    const turned = layout.portrait !== screen.portrait;
    const resized = layout.width !== screen.width || layout.height !== screen.height;
    if (turned || resized || (layout.wide !== screen.wide && current === browser)) {
      setLayout({ ...layout, wide: current === browser || turned ? layout.wide : screen.wide });
      browserRelayout();
      if (screen.portrait || turned) rebuildDialogs();
      else for (const dialog of [detail, about]) if (dialog) dialog.x = dialogX();
    }

    const pad = yield* plot(current, DIALOG_MASK_COLOR);
    frame++;
    if (last !== current) {
      frame = 0;
      last = current;
    }

    if (current === browser) {
      if (pad.swipe) {
        yield* browserGenView(pad.swipe > 0 ? 'next' : 'previous');
        continue;
      }
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
        else if (clicked === VIEW_MODE) yield* browserSwitchMode();
        else if (clicked === INFO) {
          // HBC hides the pointer over About; the page keeps it so the source link can be clicked.
          about = dialogAbout(browser);
          current = about;
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

      // Held B on a long description grabs it, so the text follows the hand. HBC pulls it along like a
      // joystick instead, which a mouse makes feel dead. B anywhere else backs out, as does a click outside.
      const dragging = detail.drag && detail.dragWidget === 6;
      const clickedOutside = (pad.down & A) !== 0 && pointing() && widgetAtPointer(detail) === -1;
      const text = detail.widgets[6]!;
      grabbedAt = dragging ? (grabbedAt ?? text.y) : null;
      if (grabbedAt !== null) scroll += grabbedAt + detail.dragY - text.y;
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
      const result = aboutStep(about, pad, frame);
      if (result === 'link') open(SOURCE_URL, '_blank', 'noopener');
      if (result === 'close') {
        yield* dialogFade(about, false);
        current = browser;
        about = null;
      }
    }
  }
}

async function start() {
  const canvas = document.querySelector<HTMLCanvasElement>('#tv')!;
  await loadTheme();
  loadApps();
  setLayout(windowLayout());
  browserInit();
  listen(canvas, grabButtonAt);
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
