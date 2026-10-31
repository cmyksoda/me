// Bubbles: fewest at 4 in the morning, most at 4 in the afternoon, and they pop at a touch (bubbles.c).

import { drawTurned, screen, VIEW_HEIGHT, WIDTH_16_9 } from './gfx';
import { theme } from './theme';

const MAX_COUNT = 20;
const MIN_COUNT = 4;
const DAY = 60 * 24;
const QUIETEST = 60 * 4;
const BUSIEST_AFTER = 60 * 12;
const SIZE = 64;
const AREA_16_9 = WIDTH_16_9 * VIEW_HEIGHT;

interface Bubble {
  x: number;
  py: number;
  speed: number;
  xm: number;
  val: number;
  step: number;
  // Where gfx.c draws it: left edge, bottom edge.
  left: number;
  bottom: number;
  scale: number;
  rad: number;
  popped: boolean;
}

interface Group extends Bubble {
  tex: number;
  pieces: Bubble[];
}

const irand = (max: number) => Math.floor(max * Math.random());
const frand = (max: number) => max * Math.random();
const roundf = (value: number) => Math.sign(value) * Math.round(Math.abs(value));

const bubbles: Group[] = [];
let target = -1;
let divider = 0;

function spawn(): Group {
  const tex = irand(3);
  const x = irand(screen.width);
  const py = screen.height + irand(200);
  const speed = 1.2 + frand(4 - tex);
  return {
    tex, x, py, speed, xm: 3 + irand(tex + 1) * speed, val: 0, step: (2 * Math.PI) / (64 + frand(64)),
    left: x, bottom: py + SIZE, scale: 0.4 + frand(0.6), rad: frand(Math.PI / 4), popped: false, pieces: [],
  };
}

function updateCount() {
  if (divider++ >= 600 || target < 0) {
    divider = 0;
    const now = new Date();
    const minute = (now.getHours() * 60 + now.getMinutes() - QUIETEST + DAY) % DAY;
    target = minute <= BUSIEST_AFTER
      ? Math.trunc(((MAX_COUNT - MIN_COUNT) * minute) / BUSIEST_AFTER) + MIN_COUNT
      : Math.trunc(((MAX_COUNT - MIN_COUNT) * (DAY - minute)) / (DAY - BUSIEST_AFTER)) + MIN_COUNT;
  }
  if (divider % 6 === 0) {
    // Views larger than 16:9 get more bubbles, so the water stays as busy.
    const count = Math.round((target * Math.max(screen.width * screen.height, AREA_16_9)) / AREA_16_9);
    while (bubbles.length < count) bubbles.push(spawn());
    if (bubbles.length > count) bubbles.pop();
  }
}

// bubbles.c tests a square around the middle, after truncating the distance to whole pixels.
function touches(b: Bubble, x: number, y: number) {
  const radius = (b.scale * SIZE) / 2 * 0.8;
  return Math.abs(Math.trunc(x - (b.left + SIZE / 2))) < radius && Math.abs(Math.trunc(y - (b.bottom - SIZE / 2))) < radius;
}

function pop(b: Group) {
  b.popped = true;
  b.pieces = [];
  const count = irand(5) + 5;
  for (let i = 0; i < count; i++) {
    const angle = frand(2 * Math.PI);
    const x = b.x + Math.sin(angle) * frand(40);
    const py = b.bottom + (Math.cos(angle) - 1.5) * frand(30);
    b.pieces.push({
      x, py, speed: b.speed - 0.5 + frand(4 - b.tex), xm: b.xm * (0.8 + frand(1)), val: b.val,
      step: b.step * (0.8 + frand(0.4)), left: x, bottom: py + SIZE, scale: (0.2 + frand(0.2)) * b.scale,
      rad: b.rad, popped: false,
    });
  }
}

// Rises one frame; false once it has left the top of the screen.
function rise(b: Bubble) {
  b.py -= b.speed;
  b.bottom = b.py;
  if (b.bottom < -100) return false;
  b.left = b.x + roundf(b.xm * Math.sin(b.val));
  b.val += b.step;
  return true;
}

export function updateBubbles(pointing: boolean, x: number, y: number) {
  updateCount();
  for (let i = 0; i < bubbles.length; i++) {
    const b = bubbles[i];
    if (!b.popped && pointing && touches(b, x, y)) pop(b);
    if (b.popped) {
      let gone = 0;
      for (const piece of b.pieces) {
        if (!piece.popped && pointing && touches(piece, x, y)) piece.popped = true;
        piece.py -= piece.speed;
        piece.bottom = piece.py;
        if (piece.bottom < -100 || piece.popped) {
          gone++;
          continue;
        }
        piece.left = piece.x + roundf(piece.xm * Math.sin(piece.val));
        piece.val += piece.step;
      }
      if (gone >= b.pieces.length) bubbles[i] = spawn();
    } else if (!rise(b)) {
      bubbles[i] = spawn();
    }
  }
}

function draw(b: Bubble, tex: number) {
  drawTurned(theme[`bubble${tex + 1}`], b.left, b.bottom - SIZE, b.scale, b.rad);
}

export function drawBubbles() {
  for (const b of bubbles) {
    if (b.popped) for (const piece of b.pieces) if (!piece.popped) draw(piece, b.tex);
  }
  for (const b of bubbles) if (!b.popped) draw(b, b.tex);
}
