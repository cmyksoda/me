import './style.css';

type FileEntry = { url: string; size: number; sha256: string };
type Region = { code: string; label: string; menu: string; mym: FileEntry; csm: FileEntry };
type Theme = {
  name: string; shade: string; hex: string; version: string; author: string; regions: Region[]; special?: string
};
type Data = { themes: Theme[]; screens: string[]; piinkOriginals: (FileEntry & { name: string })[] };

const SCREEN_NAMES: Record<string, string> = {
  'menu': 'Wii Menu',
  'disc-channel': 'Disc Channel',
  'home-menu': 'HOME Menu',
  'wii-options': 'Wii options',
  'wii-settings': 'Wii Settings',
  'board-create': 'New message',
  'memo': 'Memo',
  'keyboard': 'Keyboard',
};

const base = new URL('../wii-themes/', document.baseURI);
const asset = (path: string) => new URL(path.replace(/^wii-themes\//, ''), base).href;
const shot = (theme: string, screen: string) => asset(`shots/${theme.toLowerCase()}/${screen}.webp`);
const megabytes = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)} MB`;

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  children: (Node | string)[] = [],
) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function download(file: FileEntry, label: string) {
  const name = file.url.split('/').pop() ?? '';
  return element('a', { className: 'pill', href: asset(file.url), download: name, title: `SHA-256 ${file.sha256}` }, [
    label, element('span', { className: 'size' }, [megabytes(file.size)]),
  ]);
}

function show(data: Data, theme: Theme, focus = false) {
  document.documentElement.style.setProperty('--accent', theme.hex);
  document.documentElement.classList.toggle('rainbow', theme.special === 'rainbow');
  for (const tile of document.querySelectorAll<HTMLButtonElement>('.tile')) {
    const on = tile.dataset.theme === theme.name;
    tile.setAttribute('aria-checked', String(on));
    tile.tabIndex = on ? 0 : -1;
    if (on && focus) tile.focus();
  }

  const hero = document.getElementById('hero-shot') as HTMLImageElement;
  hero.src = shot(theme.name, 'menu');
  hero.alt = `The Wii Menu with the ${theme.name} theme`;

  document.getElementById('theme-name')!.textContent = `${theme.name} v${theme.version}`;
  const by = theme.author === 'wilsoff' ? 'by wilsoff, updated by cmyksoda' : 'by cmyksoda';
  document.getElementById('theme-note')!.textContent = theme.special === 'rainbow'
    ? `Every color, red on the left to violet on the right, ${by}`
    : `${theme.shade} ${theme.hex}, ${by}`;

  document.querySelector('#downloads tbody')!.replaceChildren(...theme.regions.map(region => element('tr', {}, [
    element('th', { scope: 'row' }, [
      `${region.label} `,
      element('span', { className: 'region' }, [`· ${region.code}`]),
    ]),
    element('td', {}, [download(region.csm, 'csm')]),
    element('td', {}, [download(region.mym, 'mym')]),
  ])));

  document.getElementById('screens')!.replaceChildren(...data.screens.map(screen => {
    const label = SCREEN_NAMES[screen] ?? screen;
    return element('figure', { className: 'screen' }, [
      element('a', { href: shot(theme.name, screen) }, [
        element('img', {
          src: shot(theme.name, screen), width: 640, height: 478, loading: 'lazy',
          alt: `${label} with the ${theme.name} theme`,
        }),
      ]),
      element('figcaption', {}, [label]),
    ]);
  }));
}

function setupModeToggle() {
  const toggle = document.querySelector<HTMLButtonElement>('.mode-toggle')!;
  const apply = (mode: string) => {
    document.documentElement.dataset.theme = mode;
    toggle.setAttribute('aria-pressed', String(mode === 'dark'));
    for (const span of toggle.querySelectorAll<HTMLElement>('span'))
      span.classList.toggle('on', span.dataset.mode === mode);
  };
  apply(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  toggle.addEventListener('click', event => {
    // A pointer click only counts on the other mode's word; keyboard presses land on the button itself.
    const word = (event.target as HTMLElement).closest<HTMLElement>('span[data-mode]');
    const current = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
    if (event.target !== toggle && word?.dataset.mode === current) return;
    if (event.target !== toggle && !word) return;
    const mode = current === 'dark' ? 'light' : 'dark';
    apply(mode);
    try { localStorage.setItem('cmyksoda-theme', mode); } catch {}
  });
}

async function main() {
  setupModeToggle();
  const data: Data = await (await fetch(asset('themes.json'))).json();
  const tiles = document.getElementById('tiles')!;
  tiles.replaceChildren(...data.themes.map(theme => {
    const tile = element('button', { type: 'button', className: 'tile' }, [
      element('img', { src: shot(theme.name, 'disc-channel'), width: 640, height: 478, alt: '' }),
      element('span', { className: 'tile-name' }, [theme.name]),
    ]);
    tile.dataset.theme = theme.name;
    tile.setAttribute('role', 'radio');
    tile.style.setProperty('--tile-accent', theme.hex);
    if (theme.special === 'rainbow') tile.classList.add('rainbow-tile');
    tile.addEventListener('click', () => show(data, theme));
    return tile;
  }));

  tiles.addEventListener('keydown', event => {
    const keys: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    if (!(event.key in keys)) return;
    event.preventDefault();
    const current = data.themes.findIndex(
      t => document.querySelector(`.tile[data-theme="${t.name}"]`)?.getAttribute('aria-checked') === 'true',
    );
    const next = data.themes[(current + keys[event.key] + data.themes.length) % data.themes.length];
    show(data, next, true);
  });

  document.getElementById('originals')!.replaceChildren(...data.piinkOriginals.map(file => element('li', {}, [
    element('span', { className: 'file-name' }, [file.name]), download(file, 'mym'),
  ])));

  show(data, data.themes[0]);
  preload(data);
}

/** Fetch every theme's screenshots once the first theme is up, so switching themes never flickers. */
function preload(data: Data) {
  const start = () => {
    for (const theme of data.themes) {
      for (const screen of data.screens) new Image().src = shot(theme.name, screen);
    }
  };
  if ('requestIdleCallback' in window) requestIdleCallback(start);
  else setTimeout(start, 500);
}

main();
