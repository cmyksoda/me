// HBC 1.1.3's default theme, Dark Water by drmr, plus the app icons (theme.c).

import droid from './assets/droid.woff2';
import droidBold from './assets/droidbold.woff2';

const themeFiles = import.meta.glob<string>('./assets/*.png', { eager: true, import: 'default' });
const iconFiles = import.meta.glob<string>('./icons/*.png', { eager: true, import: 'default' });

export const theme: Record<string, HTMLImageElement> = {};
export const icons = new Map<string, HTMLImageElement>();

const fileName = (path: string) => path.slice(path.lastIndexOf('/') + 1, -'.png'.length);

async function loadImage(url: string) {
  const image = new Image();
  image.src = url;
  await image.decode();
  return image;
}

export async function loadTheme() {
  const fonts = [
    new FontFace('hbc-droid', `url(${droid})`, { weight: '400' }),
    new FontFace('hbc-droid', `url(${droidBold})`, { weight: '700' }),
  ];
  for (const font of fonts) document.fonts.add(font);
  await Promise.all([
    ...fonts.map((font) => font.load()),
    ...Object.entries(themeFiles).map(async ([path, url]) => {
      theme[fileName(path)] = await loadImage(url);
    }),
    ...Object.entries(iconFiles).map(async ([path, url]) => {
      icons.set(fileName(path), await loadImage(url));
    }),
  ]);
}
