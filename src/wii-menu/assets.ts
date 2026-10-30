import { parseBRLAN, type Animation } from './lyt/brlan';
import { parseBRLYT, type Layout } from './lyt/brlyt';
import { decompressASH, unwrapChannelFile } from './lyt/compression';
import { LayoutInstance } from './lyt/layout';
import type { Renderer } from './lyt/renderer';
import { parseU8 } from './lyt/u8';

/** The page's folder, so assets resolve the same at /wii-forwarders and /wii-forwarders/. */
export const root = new URL(location.pathname.endsWith('/') || location.pathname.endsWith('.html') ? '.' : `${location.pathname}/`, location.href);

const MENU_ARCHIVES = [
  'chanSel', 'chanTtl', 'cmnBtn', 'cursor', 'balloon', 'board', 'letter', 'dlgWdw', 'sdButton', 'sdChanSel', 'sdChanTtl',
] as const;
const FONTS = ['RevoIpl_RodinNTLGPro_DB_32_I4', 'RevoIpl_UtrilloProGrecoStd_M_32_I4', 'RevoIpl_RodinNTLGPro_DB_48_IA4'];

export type MenuArchive = (typeof MENU_ARCHIVES)[number];

/** A U8 archive of layouts, animations and textures, as the menu and channels ship them. */
export class Archive {
  private readonly layouts = new Map<string, Layout>();
  private readonly animations = new Map<string, Animation>();

  constructor(readonly files: Map<string, Uint8Array>) {}

  layout(name: string): Layout {
    let layout = this.layouts.get(name);
    if (!layout) {
      const data = this.files.get(`arc/blyt/${name}.brlyt`);
      if (!data) throw new Error(`No layout ${name}`);
      this.layouts.set(name, (layout = parseBRLYT(data)));
    }
    return layout;
  }

  animation(name: string): Animation | null {
    if (!this.animations.has(name)) {
      const data = this.files.get(`arc/anim/${name}.brlan`);
      if (!data) return null;
      this.animations.set(name, parseBRLAN(data));
    }
    return this.animations.get(name)!;
  }

  instance(name: string): LayoutInstance {
    return new LayoutInstance(this.layout(name), this.files);
  }
}

async function fetchBytes(path: string): Promise<Uint8Array> {
  const response = await fetch(new URL(path, root));
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

/** What every channel carries: its title id, its name and the icon and banner from its WAD. */
export interface ChannelBase {
  id: string;
  name: string;
  icon: Archive;
  banner: Archive;
}

export interface Channel extends ChannelBase {
  repo: string;
}

/** A channel on the SD Card Menu; its WAD's link is null until the WAD is posted. */
export interface SdChannel extends ChannelBase {
  download: string | null;
}

export interface Assets {
  menu: Record<MenuArchive, Archive>;
  messages: Record<string, string>;
  channels: Channel[];
  sdChannels: SdChannel[];
}

/** Every channel listed in `<folder>.json`, with the icon and banner unpacked into `<folder>/<id>/`. */
async function loadChannels<T extends ChannelBase>(folder: string): Promise<T[]> {
  const list: Omit<T, 'icon' | 'banner'>[] = await (await fetch(new URL(`${folder}.json`, root))).json();
  return Promise.all(list.map(async (entry) => {
    const [icon, banner] = await Promise.all(
      ['icon.bin', 'banner.bin'].map((file) => fetchBytes(`${folder}/${entry.id}/${file}`)),
    );
    return {
      ...entry,
      icon: new Archive(parseU8(unwrapChannelFile(icon))),
      banner: new Archive(parseU8(unwrapChannelFile(banner))),
    } as T;
  }));
}

export async function loadAssets(renderer: Renderer): Promise<Assets> {
  const menuEntries = await Promise.all(MENU_ARCHIVES.map(async (name) => {
    const files = parseU8(decompressASH(await fetchBytes(`menu/${name}.ash`)));
    return [name, new Archive(files)] as const;
  }));
  await Promise.all(FONTS.map((font) => renderer.loadFont(font, new URL(`menu/fonts/${font}`, root).href)));
  const messages = await (await fetch(new URL('menu/messages.json', root))).json();
  const [channels, sdChannels] = await Promise.all([loadChannels<Channel>('channels'), loadChannels<SdChannel>('sd-channels')]);
  return { menu: Object.fromEntries(menuEntries) as Record<MenuArchive, Archive>, messages, channels, sdChannels };
}
