// A Wii Remote made of a mouse and keyboard (controls.c): left button A, right button B.

import { cssToView, screen, toView, VIEW_HEIGHT } from './gfx';

export const A = 1;
export const B = 2;
export const UP = 4;
export const DOWN = 8;
export const LEFT = 16;
export const RIGHT = 32;
export const PLUS = 64;
export const MINUS = 128;
export const TWO = 256;
export const DPAD = UP | DOWN | LEFT | RIGHT;

export interface Pad {
  down: number;
  held: number;
  up: number;
}

// Whole view pixels for the logic, like the IR position; exact ones for drawing the hand.
// Until the mouse moves, the remote points just past the TV's corner: valid, so nothing keeps focus, but not drawn.
export const pointer = { x: -64, y: -64, exactX: -64, exactY: -64, valid: true };

const keys: Record<string, number> = {
  Enter: A,
  ' ': A,
  Escape: B,
  Backspace: B,
  ArrowUp: UP,
  ArrowDown: DOWN,
  ArrowLeft: LEFT,
  ArrowRight: RIGHT,
  '+': PLUS,
  '=': PLUS,
  '-': MINUS,
  '2': TWO,
};

const WHEEL_STEP = 40;

let held = 0;
let pressed = 0;
let released = 0;
let mouseButtons = 0;
let wheel = 0;

function press(button: number) {
  if (held & button) return;
  held |= button;
  pressed |= button;
  released &= ~button;
}

function release(button: number) {
  if (!(held & button)) return;
  held &= ~button;
  released |= button;
}

export function scanPad(): Pad {
  const down = pressed;
  // A click shorter than a frame still holds its button for one frame.
  const up = released & ~pressed;
  released &= pressed;
  pressed = 0;

  // Each wheel step is one press of the D-pad.
  let scroll = 0;
  if (wheel <= -WHEEL_STEP) {
    scroll = UP;
    wheel += WHEEL_STEP;
  } else if (wheel >= WHEEL_STEP) {
    scroll = DOWN;
    wheel -= WHEEL_STEP;
  }
  return { down: down | scroll, held: held | down, up };
}

function setPointer(x: number, y: number) {
  pointer.exactX = x;
  pointer.exactY = y;
  pointer.x = Math.floor(x);
  pointer.y = Math.floor(y);
  // WPAD_SetVRes gives the pointer 64 pixels beyond each edge.
  pointer.valid = x >= -64 && y >= -64 && x < screen.width + 64 && y < VIEW_HEIGHT + 64;
}

function trackButtons(event: PointerEvent) {
  const buttons = event.buttons & 3;
  const changed = buttons ^ mouseButtons;
  if (changed & 1) (buttons & 1 ? press : release)(A);
  if (changed & 2) (buttons & 2 ? press : release)(B);
  if (changed & ~buttons & 2) unlockPointer();
  mouseButtons = buttons;
}

function track(event: PointerEvent) {
  const { x, y } = toView(event.clientX, event.clientY);
  setPointer(x, y);
  trackButtons(event);
}

// Vivaldi's mouse gestures take over a right-button drag unless the pointer is locked to the page.
// A locked pointer reports only its movement, which moves the hand by the same amount.
function lockPointer(canvas: HTMLCanvasElement) {
  try {
    canvas.requestPointerLock()?.catch(() => {});
  } catch {}
}

function unlockPointer() {
  if (document.pointerLockElement) document.exitPointerLock();
}

function releaseAll() {
  for (const button of [A, B, UP, DOWN, LEFT, RIGHT, PLUS, MINUS, TWO]) release(button);
  mouseButtons = 0;
  unlockPointer();
}

// `scrolls` says whether B would now drag something: the hand is open over text that scrolls.
export function listen(canvas: HTMLCanvasElement, scrolls: () => boolean) {
  canvas.addEventListener('pointerdown', (event) => {
    canvas.setPointerCapture(event.pointerId);
    if (event.button === 2 && event.pointerType === 'mouse' && scrolls()) lockPointer(canvas);
    track(event);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (document.pointerLockElement === canvas) {
      setPointer(pointer.exactX + cssToView(event.movementX), pointer.exactY + cssToView(event.movementY));
      trackButtons(event);
      return;
    }
    track(event);
    // Out past the TV's edges, the system pointer comes back so it can't get lost in the black bars.
    canvas.style.cursor = pointer.valid ? 'none' : 'auto';
  });
  // A lock that arrives after the button is up would otherwise hold the pointer until Escape.
  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement === canvas && !(mouseButtons & 2)) unlockPointer();
  });
  canvas.addEventListener('pointerup', (event) => {
    track(event);
    if (event.pointerType !== 'mouse') pointer.valid = false;
  });
  canvas.addEventListener('pointercancel', () => {
    releaseAll();
    pointer.valid = false;
  });
  canvas.addEventListener('pointerleave', () => {
    pointer.valid = false;
  });
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? VIEW_HEIGHT : 1;
    wheel = Math.min(Math.max(wheel + event.deltaY * unit, -10 * WHEEL_STEP), 10 * WHEEL_STEP);
  }, { passive: false });

  addEventListener('keydown', (event) => {
    const button = keys[event.key];
    if (!button || event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();
    if (event.repeat) return;
    // Using the D-pad means the remote points away from the screen.
    if (button & DPAD) pointer.valid = false;
    press(button);
  });
  addEventListener('keyup', (event) => {
    if (keys[event.key]) release(keys[event.key]);
  });
  addEventListener('blur', releaseAll);
}
