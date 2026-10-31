import type { Texture } from './lyt/tpl';

// my_TopBtn_c is the plain face (my_TopBtn_a) with the Wii logo darkened into it at 0.77.
const LOGO_SHADE = 0.77;
const SUPERSAMPLE = 4;

/** The Wii button's art with a speaker for its logo: sound waves while sound is on, a cross while it's off. */
export function speakerButton(face: Texture, art: Texture, on: boolean): Texture {
  const cover = speakerCoverage(art.width, art.height, on);
  const rgba = new Uint8Array(art.rgba);
  for (let i = 0; i < cover.length; i++) {
    const gray = Math.round(face.rgba[i * 4] * (1 - (1 - LOGO_SHADE) * cover[i]));
    rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = gray;
  }
  return { ...art, rgba };
}

/** How much of each texel the speaker covers, drawn at four times the size and averaged down. */
function speakerCoverage(width: number, height: number, on: boolean): Float32Array {
  const canvas = document.createElement('canvas');
  canvas.width = width * SUPERSAMPLE;
  canvas.height = height * SUPERSAMPLE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.scale(SUPERSAMPLE, SUPERSAMPLE);
  ctx.fillStyle = ctx.strokeStyle = '#fff';
  ctx.lineJoin = ctx.lineCap = 'round';

  // The speaker sits where the logo was, about as tall and as heavy.
  ctx.beginPath();
  ctx.moveTo(25, 34);
  ctx.lineTo(31, 34);
  ctx.lineTo(38, 28.5);
  ctx.lineTo(38, 48.5);
  ctx.lineTo(31, 43);
  ctx.lineTo(25, 43);
  ctx.closePath();
  ctx.lineWidth = 1.5;
  ctx.fill();
  ctx.stroke();

  ctx.lineWidth = 3.8;
  if (on) {
    for (const radius of [6.5, 12.5]) {
      ctx.beginPath();
      ctx.arc(38, 38.5, radius, -Math.PI / 4, Math.PI / 4);
      ctx.stroke();
    }
  } else {
    ctx.beginPath();
    ctx.moveTo(43.5, 33.5);
    ctx.lineTo(53.5, 43.5);
    ctx.moveTo(43.5, 43.5);
    ctx.lineTo(53.5, 33.5);
    ctx.stroke();
  }

  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const cover = new Float32Array(width * height);
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      cover[Math.floor(y / SUPERSAMPLE) * width + Math.floor(x / SUPERSAMPLE)] +=
        pixels[(y * canvas.width + x) * 4 + 3] / 255;
    }
  }
  return cover.map((sum) => sum / SUPERSAMPLE ** 2);
}
