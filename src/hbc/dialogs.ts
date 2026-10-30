// The app details and About dialogs, and their slide up from the bottom (dialogs.c).

import type { App } from './apps';
import { B } from './controls';
import { lineSpacing } from './font';
import { screen, VIEW_HEIGHT } from './gfx';
import { theme } from './theme';
import { newView, plot, setFocus, type View } from './view';
import { button, image, label, memo, memoDeco } from './widgets';

export const DIALOG_MASK_COLOR = 0x101010a0;
const TRANS_STEPS = 15;

// Draft for Jaxi's review: what this page is, and whose work it shows.
const notice = [
  'About this page',
  '',
  "This page recreates the Homebrew Channel in your browser to list cmyksoda's Wii homebrew apps. "
    + 'Its code is free software under the GNU AGPLv3.',
  '',
  'Source code: https://github.com/cmyksoda/me',
  '',
  "The Homebrew Channel's graphics and fonts come from its open source release by Team Twiizers, "
    + 'under the GNU GPLv2 or later. The Droid Sans fonts are by Google, under the Apache License 2.0.',
  '',
  'Not affiliated with Nintendo or Team Twiizers. Wii is a trademark of Nintendo.',
].join('\n');

// HBC 1.1.3's own About text, word for word, with the default theme's line between its halves.
const creditsPre = [
  'Credits',
  '',
  'The Homebrew Channel was made possible by the following people:',
  '',
  'dhewg (EWRONGCHAN) - application code, geckoloader code',
  'blasty (ESTONED) - application code',
  'marcan (EFAILURE) - reload stub, banner, installer, packaging',
  'bushing (EWANTPONY) - socket code, loader code',
  'segher (EBUGFOUND) - nandloader stub code',
  'souLLy (ENOTHERE) - banner graphics',
  'drmr (EMORECOWBELL) - banner audio, channel graphics',
  'mha (E404) - update server and hosting',
].join('\n');

const creditsPost = [
  'Powered by devkitPPC and libogc, by shagkur, WinterMute, and everyone else who contributed',
  '',
  'Thanks to all the beta testers',
  '',
  'Kind regards to the following people too:',
  '',
  'sepp256 - dropped some good GX hints',
  'chishm, svpe, rodries, hermes - libfat port',
  'alien - some graphics',
  'jodi - the lulz',
  '',
  'And last but not least, thanks to the authors of the following libraries:',
  '',
  "wiiuse - para's Wiimote library, now integrated with libogc",
  'libpng - the official PNG library',
  'Mini-XML - small and efficient XML parsing library',
  'FreeType - the free TrueType/OpenType font renderer',
  '',
].join('\n');

const aboutText = `${notice}\n\n${creditsPre}\n\nTheme: Dark Water by drmr\n\n${creditsPost}`;

const roundf = (value: number) => Math.sign(value) * Math.round(Math.abs(value));

// The mask color is stepped as one 32-bit number, so fading out also carries into its blue byte.
// The slide stops a step short of sin(pi/2), which leaves dialogs resting at y 47, not 44.
export function* dialogFade(v: View, fadeIn: boolean) {
  const step = Math.PI / (2 * TRANS_STEPS);
  const alphaStep = Math.trunc((DIALOG_MASK_COLOR & 0xff) / TRANS_STEPS);
  const y = fadeIn ? v.y + VIEW_HEIGHT : v.y;
  let angle = fadeIn ? 0 : Math.PI;
  let color = fadeIn ? (DIALOG_MASK_COLOR & 0xffffff00) >>> 0 : DIALOG_MASK_COLOR;
  for (let i = 0; i < TRANS_STEPS; i++) {
    v.y = y - roundf(VIEW_HEIGHT * Math.sin(angle));
    angle += step;
    color = (color + (fadeIn ? alphaStep : -alphaStep & 0xff)) >>> 0;
    yield* plot(v, color);
  }
}

export function dialogApp(app: App, subView: View) {
  const background = theme.dialog_background;
  const tiny = theme.button_tiny;
  const v = newView(11, subView, Math.trunc((screen.width - background.width) / 2), 44, B);
  const w = v.widgets;
  const textX = 48 + 128;
  const textWidth = background.width - 72 - 128;

  w[0] = image(0, 0, background);
  w[1] = label(32, 16, app.name, background.width - 64, 'center', 'ascender', 'dlgtitle');
  if (app.icon) w[2] = image(32, 48, app.icon);
  w[3] = label(textX, 72, app.version ? `Version: ${app.version}` : '', textWidth, 'left', 'descender', 'label');
  w[4] = label(textX, 72, app.coder ? `Author: ${app.coder}` : '', textWidth, 'left', 'ascender', 'label');

  const buttonsY = background.height - tiny.height - 16;
  const memoY = 48 + 48 + 8;
  const description = app.longDescription ?? 'no description available';
  [w[5], w[6], w[7]] = memoDeco(32, memoY, background.width - 64, buttonsY - memoY - 8, description, 'left');

  // Delete and Load become Source and Download.
  const gap = Math.trunc((background.width - tiny.width * 3) / 4);
  w[8] = button(gap, buttonsY, 'Source');
  w[9] = button(gap * 2 + tiny.width, buttonsY, 'Download');
  w[10] = button(gap * 3 + tiny.width * 2, buttonsY, 'Back');
  // As upstream 1.1.3 (dialogs.c:241); hbc-reborn later moved the focus to Load.
  setFocus(v, 10);
  return v;
}

export function dialogAbout(subView: View) {
  const background = theme.dialog_background;
  const logo = theme.about;
  const v = newView(3, subView, Math.trunc((screen.width - background.width) / 2), 44);
  v.widgets[0] = image(0, 0, background);
  v.widgets[1] = image(Math.trunc((background.width - logo.width) / 2), 16, logo);

  // The memo is trimmed to whole lines and centered in the space left.
  const spacing = lineSpacing('memo');
  let top = 16 + logo.height + 8;
  let height = background.height - 16 - top - 8;
  const whole = Math.trunc(height / spacing) * spacing;
  if (whole < height) {
    top += Math.trunc((height - whole) / 2);
    height = whole;
  }
  const credits = memo(32, top, background.width - 64, height, aboutText, 'center');
  credits.cursor = 'standard';
  v.widgets[2] = credits;
  return v;
}
