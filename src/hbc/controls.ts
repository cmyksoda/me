// A Wii Remote made of a mouse and keyboard (controls.c): left button A, right button B.
// A finger is the same remote with neither button: a tap presses A, and a finger on scrolling text holds the grab button.

import { screen, toView, VIEW_HEIGHT } from './gfx';

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
  // A finger's swipe across the screen this frame: 1 leftward (the next page), -1 rightward.
  swipe: number;
}

// Whole view pixels for the logic, like the IR position; exact ones for drawing the hand.
// Until the mouse moves, the remote points just past the TV's corner: valid, so nothing keeps focus, but not drawn.
export const pointer = { x: -64, y: -64, exactX: -64, exactY: -64, valid: true, touch: false };

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
// In CSS pixels: how far a finger may wander and still be tapping, and how far across it must go to be a swipe.
export const TAP_SLOP = 10;
const SWIPE_DISTANCE = 48;
// A lifted finger's position stays valid this many frames, long enough for the loop to act on its tap.
const LIFT_FRAMES = 3;

interface Finger {
  x: number;
  y: number;
  grab: number;
  wandered: boolean;
}

let held = 0;
let pressed = 0;
let released = 0;
let mouseButtons = 0;
let wheel = 0;
let finger: Finger | null = null;
let swipe = 0;
let lift = 0;
let grabButtonAt: (x: number, y: number) => number = () => 0;

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
  if (lift > 0 && --lift === 0) pointer.valid = false;
  const swiped = swipe;
  swipe = 0;
  return { down: down | scroll, held: held | down, up, swipe: swiped };
}

function setPointer(x: number, y: number) {
  pointer.exactX = x;
  pointer.exactY = y;
  pointer.x = Math.floor(x);
  pointer.y = Math.floor(y);
  // WPAD_SetVRes gives the pointer 64 pixels beyond each edge.
  pointer.valid = x >= -64 && y >= -64 && x < screen.width + 64 && y < screen.height + 64;
}

function trackButtons(event: PointerEvent) {
  const buttons = event.buttons & 3;
  const changed = buttons ^ mouseButtons;
  if (changed & 1) (buttons & 1 ? press : release)(A);
  if (changed & 2) (buttons & 2 ? press : release)(B);
  mouseButtons = buttons;
}

function track(event: PointerEvent) {
  const { x, y } = toView(event.clientX, event.clientY);
  setPointer(x, y);
  trackButtons(event);
}

function releaseAll() {
  for (const button of [A, B, UP, DOWN, LEFT, RIGHT, PLUS, MINUS, TWO]) release(button);
  mouseButtons = 0;
  finger = null;
}

function touchTo(event: PointerEvent) {
  const { x, y } = toView(event.clientX, event.clientY);
  setPointer(x, y);
}

function touchStart(event: PointerEvent) {
  if (!event.isPrimary) return;
  touchTo(event);
  pointer.touch = true;
  lift = 0;
  const grab = grabButtonAt(pointer.x, pointer.y);
  finger = { x: event.clientX, y: event.clientY, grab, wandered: false };
  if (grab) press(grab);
}

function touchMove(event: PointerEvent) {
  if (!finger || !event.isPrimary) return;
  touchTo(event);
  finger.wandered ||= Math.hypot(event.clientX - finger.x, event.clientY - finger.y) > TAP_SLOP;
}

// A tap acts where the finger lifts, so a swipe can't open an app. A grab lasts as long as the finger is down.
function touchEnd(event: PointerEvent) {
  if (!finger || !event.isPrimary) return;
  touchTo(event);
  const { x, y, grab, wandered } = finger;
  finger = null;
  lift = LIFT_FRAMES;
  if (grab) return release(grab);
  if (!wandered) {
    press(A);
    release(A);
    return;
  }
  const [across, down] = [event.clientX - x, event.clientY - y];
  if (Math.abs(across) >= SWIPE_DISTANCE && Math.abs(across) > 1.5 * Math.abs(down)) swipe = across < 0 ? 1 : -1;
}

/** `grabAt` says which button, if any, a finger at a point presses to take hold of what is there. */
export function listen(canvas: HTMLCanvasElement, grabAt: (x: number, y: number) => number) {
  grabButtonAt = grabAt;
  canvas.addEventListener('pointerdown', (event) => {
    canvas.setPointerCapture(event.pointerId);
    if (event.pointerType === 'touch') return touchStart(event);
    pointer.touch = false;
    track(event);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'touch') return touchMove(event);
    pointer.touch = false;
    track(event);
    // Out past the TV's edges, the system pointer comes back so it can't get lost in the black bars.
    canvas.style.cursor = pointer.valid ? 'none' : 'auto';
  });
  canvas.addEventListener('pointerup', (event) => {
    if (event.pointerType === 'touch') return touchEnd(event);
    track(event);
    if (event.pointerType !== 'mouse') pointer.valid = false;
  });
  canvas.addEventListener('pointercancel', () => {
    releaseAll();
    pointer.valid = false;
  });
  canvas.addEventListener('pointerleave', (event) => {
    if (event.pointerType !== 'touch') pointer.valid = false;
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
    pointer.touch = false;
    press(button);
  });
  addEventListener('keyup', (event) => {
    if (keys[event.key]) release(keys[event.key]);
  });
  addEventListener('blur', releaseAll);
}
