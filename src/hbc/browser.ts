// The app list and grid, and the slide between their pages (browser.c).

import { apps, type App } from './apps';
import { DOWN, LEFT, RIGHT, UP } from './controls';
import { screen } from './gfx';
import { theme } from './theme';
import { focusNext, focusPrevious, moveFocus, newView, plot, setFocus } from './view';
import { appEntry, entryHeight, gridAppEntry, image, setFlag, VISIBLE } from './widgets';

export const INFO = 2;
export const VIEW_MODE = 3;
const FIRST_ENTRY = 4;
const TRANS_STEPS = 20;
const ROWS = 5;
const ARROW_INSET = 24;
// A grid keeps this much clear of each page arrow.
const ARROW_CLEARANCE = 16;
const SAVED_MODE = 'hbc-browse-mode';

// A tall view stacks the list from near the top, a row of controls (the page arrows, with the info and view
// buttons between them) and the logo. The buttons are small, so a finger gets a wider target around each.
const TALL_TOP = 16;
const TALL_MARGIN = 12;
const TALL_GAP = 8;
const TALL_LOGO_GAP = 4;
const TALL_BUTTON_SPREAD = 26;
const TALL_BUTTON_REACH = 8;

type BrowserAction = 'add' | 'refresh' | 'next' | 'previous';

export const browser = newView(FIRST_ENTRY, null, 0, 0);

// The entries swap between two sets of widget slots, so the old page can slide out as the new one slides in.
let firstSet = true;
let setSize = ROWS;
let topOffset = 0;
let columnsCurrent = 1;
let columnsNew = 1;

const controlsY = () => screen.height - theme.logo.height - TALL_LOGO_GAP - theme.apps_previous.height;
const firstRowY = () => (screen.portrait ? TALL_TOP : 64);
const plateWidth = () => (
  screen.portrait ? Math.min(theme.apps_list.width, screen.width - 2 * TALL_MARGIN) : theme.apps_list.width
);
const rowHeight = (columns: number) => (columns === 1 ? entryHeight(plateWidth()) : theme.apps_grid.height);
const rows = (columns: number) =>
  screen.portrait ? Math.max(1, Math.trunc((controlsY() - TALL_GAP - TALL_TOP) / rowHeight(columns))) : ROWS;
const pageSize = (columns: number) => columns * rows(columns);

// As many columns as fit between the page arrows: 3 in 4:3, 4 in 16:9, and more in wider windows. A tall view
// has its arrows below the list, so its columns only keep to the margins.
const gridColumns = () => screen.portrait
  ? Math.trunc((screen.width - 2 * TALL_MARGIN) / theme.apps_grid.width)
  : Math.trunc((screen.width - 2 * (ARROW_INSET + theme.apps_previous.width + ARROW_CLEARANCE))
    / theme.apps_grid.width);
const rowStart = (columns: number) =>
  Math.trunc((screen.width - (columns === 1 ? plateWidth() : theme.apps_grid.width * columns)) / 2);

// The page's own buttons sit where the USB Gecko and network icons were: info, and the list/grid
// switch that 2 is on the Wii. A tall view puts them side by side between the page arrows.
function smallButton(side: -1 | 1, normal: HTMLImageElement, hover: HTMLImageElement) {
  if (!screen.portrait) return image(screen.width - (side < 0 ? 96 : 64), 412, normal, undefined, hover);
  const x = Math.round(screen.width / 2 + side * TALL_BUTTON_SPREAD - normal.width / 2);
  const y = controlsY() + (theme.apps_previous.height - normal.height) / 2;
  return image(x, y, normal, undefined, hover, TALL_BUTTON_REACH);
}

function viewModeButton() {
  const [normal, hover] =
    columnsNew === 1 ? [theme.view_grid, theme.view_grid_hover] : [theme.view_list, theme.view_list_hover];
  return smallButton(1, normal, hover);
}

// HBC keeps the list or grid choice in its settings.xml; this keeps it in the browser.
export function browserInit() {
  try {
    if (localStorage.getItem(SAVED_MODE) === 'grid') columnsNew = gridColumns();
  } catch {}
  browserLayout();
}

function browserLayout() {
  setSize = Math.max(pageSize(1), pageSize(gridColumns()));
  const w = (browser.widgets = Array(FIRST_ENTRY + setSize * 2).fill(null));
  const arrowsY = screen.portrait ? controlsY() : 192;
  w[0] = image(ARROW_INSET, arrowsY, theme.apps_previous, undefined, theme.apps_previous_hover);
  w[1] = image(
    screen.width - ARROW_INSET - theme.apps_next.width,
    arrowsY,
    theme.apps_next,
    undefined,
    theme.apps_next_hover,
  );
  w[INFO] = smallButton(-1, theme.info, theme.info_hover);
  w[VIEW_MODE] = viewModeButton();
  setFlag(w[0]!, VISIBLE, false);
  setFlag(w[1]!, VISIBLE, false);
}

function setTopOffset(app: App | null) {
  if (!app || !apps.length) {
    topOffset = 0;
    return;
  }
  const index = apps.indexOf(app);
  if (index >= 0) topOffset = index;
  const page = pageSize(columnsNew);
  topOffset = Math.trunc(topOffset / page) * page;
  if (topOffset > apps.length - 1) topOffset -= page;
}

// Fills one set of slots with the page at topOffset; returns the slot of `app`, or of the first entry.
function placeEntries(first: number, x: number, app: App | null) {
  let focus = first;
  let y = firstRowY();
  for (let i = 0; i < pageSize(columnsNew); i++) {
    const entry = apps[topOffset + i];
    if (entry) {
      if (entry === app) focus += i;
      browser.widgets[first + i] = columnsNew === 1
        ? appEntry(x, y, entry, plateWidth())
        : gridAppEntry(x + (i % columnsNew) * theme.apps_grid.width, y, entry);
    }
    if ((i + 1) % columnsNew === 0) y += rowHeight(columnsNew);
  }
  return focus;
}

const roundf = (value: number) => Math.sign(value) * Math.round(Math.abs(value));

// Each row starts its half-cosine slide one frame after the row above it. A page taller than HBC's five
// rows starts them all within the same five frames.
const lag = (row: number, columns: number) => Math.trunc((row * (ROWS - 1)) / Math.max(rows(columns) - 1, 1));

export function* browserGenView(action: BrowserAction, app: App | null = null) {
  if (action === 'add' || action === 'refresh') setTopOffset(app);
  if (action === 'next') {
    if (apps.length <= topOffset + pageSize(columnsNew)) return;
    topOffset += pageSize(columnsCurrent);
  }
  if (action === 'previous') {
    if (topOffset < 1 || topOffset < pageSize(columnsCurrent)) return;
    topOffset -= pageSize(columnsCurrent);
  }

  const less = topOffset > 0;
  const more = apps.length > topOffset + pageSize(columnsNew);
  const slots = setSize;
  const [oldSet, newSet] = firstSet ? [FIRST_ENTRY, FIRST_ENTRY + slots] : [FIRST_ENTRY + slots, FIRST_ENTRY];
  firstSet = !firstSet;

  const w = browser.widgets;
  const arrowLeft = w[0]!.x;
  const arrowRight = w[1]!.x;
  const x1 = rowStart(columnsCurrent);
  const half = Math.trunc(screen.width / 2);
  const xm = action === 'previous' ? half : -half;
  const x2 = rowStart(columnsNew) + (action === 'previous' ? -screen.width : screen.width);

  w.fill(null, newSet, newSet + slots);
  const focus = placeEntries(newSet, x2, app);

  const val1 = Array<number>(slots).fill(0);
  const val2 = Array<number>(slots).fill(0);
  let angle = 0;
  for (let i = 0; i < TRANS_STEPS; i++) {
    angle += (2 * Math.PI) / TRANS_STEPS;
    const s = roundf(156 * (Math.cos(angle) - 1));
    w[0]!.x = arrowLeft + s;
    w[1]!.x = arrowRight - s;

    for (let j = 0; j < slots; j++) {
      const row1 = lag(Math.trunc(j / columnsCurrent), columnsCurrent);
      const row2 = lag(Math.trunc(j / columnsNew), columnsNew);
      if (i > row1 && i < TRANS_STEPS - (ROWS - row1)) val1[j] += Math.PI / (TRANS_STEPS - 6);
      if (i > row2 && i < TRANS_STEPS - (ROWS - row2)) val2[j] += Math.PI / (TRANS_STEPS - 6);
      const leaving = w[oldSet + j];
      const arriving = w[newSet + j];
      if (leaving) leaving.x = x1 - roundf(xm * (Math.cos(val1[j]) - 1)) + (j % columnsCurrent) * theme.apps_grid.width;
      if (arriving) arriving.x = x2 - roundf(xm * (Math.cos(val2[j]) - 1)) + (j % columnsNew) * theme.apps_grid.width;
    }

    yield* plot(browser, 0);

    if (i === TRANS_STEPS / 2) {
      setFlag(w[0]!, VISIBLE, less);
      setFlag(w[1]!, VISIBLE, more);
      setFocus(browser, focus);
    }
  }

  w.fill(null, oldSet, oldSet + slots);
  columnsCurrent = columnsNew;
}

// The page as it stands, laid out again at once for a new screen width.
export function browserRelayout() {
  const app = browserSelection() ?? apps[topOffset] ?? null;
  const shown = browser.widgets.slice(FIRST_ENTRY).some(Boolean);
  if (columnsNew !== 1) columnsNew = gridColumns();
  if (columnsCurrent !== 1) columnsCurrent = columnsNew;
  browserLayout();
  if (!shown) return;

  setFocus(browser, -1);
  browser.cursor = -1;
  setTopOffset(app);
  browser.widgets.fill(null, FIRST_ENTRY);
  const focus = placeEntries(firstSet ? FIRST_ENTRY : FIRST_ENTRY + setSize, rowStart(columnsNew), app);
  setFlag(browser.widgets[0]!, VISIBLE, topOffset > 0);
  setFlag(browser.widgets[1]!, VISIBLE, apps.length > topOffset + pageSize(columnsNew));
  setFocus(browser, focus);
}

export function browserSetFocus(down: number) {
  if (columnsCurrent === 1) {
    if (down & UP) focusPrevious(browser);
    else if (down & DOWN) focusNext(browser);
    return;
  }
  if (down & LEFT) focusPrevious(browser);
  else if (down & RIGHT) focusNext(browser);
  else if (down & UP) moveFocus(browser, -columnsCurrent);
  else if (down & DOWN) moveFocus(browser, columnsCurrent);
}

export function browserSelection(): App | null {
  if (!apps.length || browser.focus < FIRST_ENTRY) return null;
  const set = firstSet ? FIRST_ENTRY : FIRST_ENTRY + setSize;
  return apps[topOffset + browser.focus - set] ?? null;
}

export function* browserSwitchMode() {
  const app = browserSelection();
  columnsNew = columnsCurrent === 1 ? gridColumns() : 1;
  browser.widgets[VIEW_MODE] = viewModeButton();
  try {
    localStorage.setItem(SAVED_MODE, columnsNew === 1 ? 'list' : 'grid');
  } catch {}
  yield* browserGenView('refresh', app);
}
