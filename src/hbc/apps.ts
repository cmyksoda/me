// The SD card's apps: cmyksoda's homebrew, read from each latest release by tools/hbc/sync_apps.py.

import data from './apps.json';
import { icons } from './theme';

interface AppData {
  repo: string;
  dirname: string;
  name: string | null;
  coder: string | null;
  version: string | null;
  shortDescription: string | null;
  longDescription: string | null;
  longDescriptionDraft?: string;
  icon: boolean;
  source: string;
  download: string | null;
}

export interface App {
  name: string;
  coder: string | null;
  version: string | null;
  shortDescription: string | null;
  longDescription: string | null;
  icon: HTMLImageElement | null;
  source: string;
  download: string | null;
}

export const apps: App[] = [];

// HBC sorts with strcasecmp, which folds ASCII only.
const fold = (text: string) => text.replace(/[A-Z]/g, (c) => c.toLowerCase());

export function loadApps() {
  for (const entry of data as AppData[]) {
    apps.push({
      name: entry.name ?? entry.dirname,
      coder: entry.coder,
      version: entry.version,
      shortDescription: entry.shortDescription,
      longDescription: entry.longDescriptionDraft ?? entry.longDescription,
      icon: entry.icon ? icons.get(entry.repo) ?? null : null,
      source: entry.source,
      download: entry.download,
    });
  }
  apps.sort((a, b) => {
    const [x, y] = [fold(a.name), fold(b.name)];
    return x < y ? -1 : x > y ? 1 : 0;
  });
}
