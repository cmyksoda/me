import { projects, type Project } from './projects';

const artwork: Record<Project['art'], string> = {
  flower: '<path class="art-shadow" d="M50 22c-11-22-34-8-23 10-25-3-29 24-5 27-17 19 4 36 20 17 3 25 29 22 27-2 19 17 36-4 17-20 25-3 22-29-2-27 7-21-18-30-25-8-2-3-5-3-9 3Z"/><path class="art-main" d="M46 18c-11-22-34-8-23 10-25-3-29 24-5 27-17 19 4 36 20 17 3 25 29 22 27-2 19 17 36-4 17-20 25-3 22-29-2-27 7-21-18-30-25-8-2-3-5-3-9 3Z"/><circle class="art-white" cx="48" cy="46" r="15"/><path class="art-line" d="M42 47q6 7 12 0"/><circle class="art-ink" cx="42" cy="41" r="1.6"/><circle class="art-ink" cx="54" cy="41" r="1.6"/>',
  orbit: '<circle class="art-shadow" cx="54" cy="48" r="27"/><circle class="art-main" cx="49" cy="44" r="27"/><ellipse class="art-line" cx="49" cy="44" rx="47" ry="14" transform="rotate(-30 49 44)"/><path class="art-highlight" d="M39 28q-12 5-10 17"/><path class="art-main" d="m85 4 2 7 7 2-7 2-2 7-2-7-7-2 7-2Z"/><circle class="art-secondary" cx="12" cy="70" r="4"/>',
  window: '<rect class="art-shadow" x="15" y="18" width="76" height="61" rx="10"/><rect class="art-white art-outline" x="9" y="12" width="76" height="61" rx="10"/><path class="art-main" d="M19 12h56a10 10 0 0 1 10 10v8H9v-8a10 10 0 0 1 10-10Z"/><path class="art-line" d="M10 30h74m-48 12-9 9 9 9m23-18 9 9-9 9m-10-21-5 27"/><circle class="art-white" cx="19" cy="21" r="2"/><circle class="art-white" cx="27" cy="21" r="2"/><circle class="art-white" cx="35" cy="21" r="2"/>',
  heart: '<path class="art-shadow" d="M17 24h14V10h21v14h14V10h21v14h14v28H87v14H73v14H59v14H45V80H31V66H17Z" transform="translate(-5 1) scale(.92)"/><path class="art-main" d="M17 24h14V10h21v14h14V10h21v14h14v28H87v14H73v14H59v14H45V80H31V66H17Z" transform="translate(-11 -5) scale(.92)"/><path class="art-highlight" d="M19 30v16m0-16h11"/>',
  disc: '<circle class="art-shadow" cx="54" cy="48" r="36"/><circle class="art-main" cx="48" cy="42" r="36"/><circle class="art-ring" cx="48" cy="42" r="27"/><circle class="art-ring" cx="48" cy="42" r="21"/><circle class="art-white" cx="48" cy="42" r="12"/><circle class="art-main" cx="48" cy="42" r="4"/><path class="art-highlight" d="m25 17 10 12m-6-15 9 13m19 28 11 13"/><path class="art-secondary" d="m85 63 2 7 7 2-7 2-2 7-2-7-7-2 7-2Z"/>',
  sparkles: '<path class="art-shadow" d="m49 9 12 28 28 12-28 12-12 28-12-28L9 49l28-12Z"/><path class="art-main" d="m44 4 12 28 28 12-28 12-12 28-12-28L4 44l28-12Z"/><path class="art-secondary" d="m82 2 5 11 11 5-11 5-5 11-5-11-11-5 11-5Z"/><path class="art-secondary" d="m16 68 3 7 7 3-7 3-3 7-3-7-7-3 7-3Z"/><path class="art-highlight" d="m44 24-6 15-15 5"/>',
};

function externalLink(url: string, label: string) {
  const link = document.createElement('a');
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = label;
  const hint = document.createElement('span');
  hint.className = 'sr-only';
  hint.textContent = ' (opens in a new tab)';
  link.append(hint);
  return link;
}

function appendDescription(paragraph: HTMLParagraphElement, text: string) {
  const inline = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*([^*]+)\*/g;
  let cursor = 0;
  for (const match of text.matchAll(inline)) {
    paragraph.append(text.slice(cursor, match.index));
    if (match[1]) {
      paragraph.append(externalLink(match[2], match[1]));
    } else {
      const emphasis = document.createElement('em');
      emphasis.textContent = match[3];
      paragraph.append(emphasis);
    }
    cursor = match.index + match[0].length;
  }
  paragraph.append(text.slice(cursor));
}

function createProjectCard(project: Project) {
  const card = document.createElement('article');
  card.className = `project-card color-${project.color}`;

  const cover = document.createElement('div');
  cover.className = 'project-cover';
  const illustration = () => {
    cover.classList.remove('has-image');
    cover.innerHTML = `<svg class="project-art" viewBox="0 0 104 96" fill="none">${artwork[project.art]}</svg>`;
    cover.setAttribute('aria-hidden', 'true');
  };
  if (project.image) {
    if (project.imageWidth) cover.style.setProperty('--image-width', `${project.imageWidth}px`);
    const img = document.createElement('img');
    img.src = `${import.meta.env.BASE_URL}${project.image.replace(/^\//, '')}`;
    img.alt = project.imageAlt;
    if (project.roundedImage) img.classList.add('rounded-image');
    if (project.imageScale) img.style.setProperty('--image-scale', String(project.imageScale));
    if (project.imageOffset) {
      img.style.setProperty('--image-offset-x', `${project.imageOffset[0]}px`);
      img.style.setProperty('--image-offset-y', `${project.imageOffset[1]}px`);
    }
    img.loading = 'lazy';
    img.decoding = 'async';
    img.addEventListener('load', () => {
      if (img.naturalWidth / img.naturalHeight >= 2) img.classList.add('wide-image');
    }, { once: true });
    img.addEventListener('error', illustration, { once: true });
    cover.classList.add('has-image');
    cover.append(img);
  } else if (project.emoji) {
    cover.classList.add('has-emoji');
    cover.textContent = project.emoji;
    cover.setAttribute('aria-hidden', 'true');
  } else {
    illustration();
  }

  const content = document.createElement('div');
  content.className = 'project-content';
  const title = document.createElement('h3');
  title.textContent = project.title;
  const heading = project.url ? externalLink(project.url, '') : document.createElement('div');
  heading.className = `project-heading${project.url ? ' project-link' : ''}`;
  if (project.url) heading.setAttribute('aria-label', `${project.title} (opens in a new tab)`);
  heading.append(cover, title);
  const description = document.createElement('p');
  appendDescription(description, project.description);
  content.append(description);
  card.append(heading, content);
  return card;
}

const grid = document.querySelector<HTMLDivElement>('#project-grid')!;
grid.append(...projects.map(createProjectCard));

// Keep the border and raised-edge masks aligned to one gradient across the grid.
function syncCardPattern() {
  grid.style.setProperty('--pattern-width', `${grid.clientWidth + 32}px`);
  grid.style.setProperty('--pattern-height', `${grid.clientHeight + 32}px`);
  for (const card of grid.querySelectorAll<HTMLElement>('.project-card')) {
    card.style.setProperty('--pattern-x', `${-card.offsetLeft - 16}px`);
    card.style.setProperty('--pattern-y', `${-card.offsetTop - 16}px`);
  }
}

const patternObserver = new ResizeObserver(syncCardPattern);
patternObserver.observe(grid);
for (const card of grid.children) patternObserver.observe(card);
syncCardPattern();

const count = document.querySelector<HTMLElement>('.project-count')!;
count.textContent = String(projects.length);
count.setAttribute('aria-label', `${projects.length} projects`);

const toggle = document.querySelector<HTMLButtonElement>('.theme-toggle')!;
const media = window.matchMedia('(prefers-color-scheme: dark)');
let hasSavedTheme = false;
try {
  hasSavedTheme = ['light', 'dark'].includes(localStorage.getItem('cmyksoda-theme') ?? '');
} catch {}

function applyTheme(theme: 'light' | 'dark') {
  document.documentElement.dataset.theme = theme;
  toggle.setAttribute('aria-label', `switch to ${theme === 'dark' ? 'light' : 'dark'} mode`);
  toggle.setAttribute('aria-pressed', String(theme === 'dark'));
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')!.content = theme === 'dark' ? '#14151b' : '#ffffff';
}

applyTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
toggle.addEventListener('click', () => {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(theme);
  hasSavedTheme = true;
  try { localStorage.setItem('cmyksoda-theme', theme); } catch {}
});
media.addEventListener('change', ({ matches }) => {
  if (!hasSavedTheme) applyTheme(matches ? 'dark' : 'light');
});
