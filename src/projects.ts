export type Project = {
  title: string;
  /** Supports inline *emphasis* and [links](https://example.com). */
  description: string;
  color: 'pink' | 'cyan' | 'lilac' | 'yellow';
  art: 'flower' | 'orbit' | 'window' | 'heart' | 'disc' | 'sparkles';
  /** Path relative to public/. Empty uses the emoji or illustrated fallback. */
  image: string;
  imageAlt: string;
  roundedImage?: boolean;
  /** Display zoom for icons with transparent padding. */
  imageScale?: number;
  emoji?: string;
  url: string;
};

export const projects: Project[] = [
  {
    title: 'VectrexWii',
    description: 'Wii port of Vecx, a Vectrex emulator. I picked up this project after it had been abandoned by its original developer, Aruskano for over a decade; it now comes with all of the originally released Vectrex games, some mods and demos, every official overlay, and *sound support*, which had been a missing feature since the project had stopped development in 2014.',
    color: 'pink', art: 'window',
    image: 'projects/vectrexwii.png', imageAlt: 'VectrexWii logo', roundedImage: true,
    url: 'https://github.com/cmyksoda/vectrexwii',
  },
  {
    title: 'WiiEAS',
    description: 'A cute little homebrew application for playing recent and live emergency alert broadcasts from the United States using the [GlobalEAS Central Alert Repository](https://alerts.globaleas.org/) API. It displays them in DASDEC style and supports live mode, where new alerts will play automatically.',
    color: 'cyan', art: 'sparkles',
    image: 'projects/wiieas.png', imageAlt: 'WiiEAS logo', roundedImage: true,
    url: 'https://github.com/cmyksoda/WiiEAS',
  },
  {
    title: 'Tanka',
    description: 'Work-in-progress. An operating system based on Haiku that seeks to run natively on the Nintendo Wii, using [ActionRetro\'s Tabby for PowerPC](https://github.com/ActionRetro/Tabby-PPC) as a baseline.',
    color: 'lilac', art: 'window',
    image: 'projects/tanka.png', imageAlt: 'Tanka logo', roundedImage: true,
    url: 'https://github.com/cmyksoda/Tanka',
  },
  {
    title: 'Sump.Stream',
    description: '24/7 synchronous broadcast of (almost) every sump on Youtube. Why? Sump.',
    color: 'cyan', art: 'orbit',
    image: '', imageAlt: '', emoji: '💧',
    url: 'https://sump.stream/',
  },
  {
    title: 'Krillion - Zen Edition',
    description: 'A modpack for the daily game Krillion. Designed for maximum stresslessness. The 25-second timer is removed and Google OAuth is replaced with a simplified local database, complete with leaderboards for comparing daily and all-time best scores with your friends. Self-hostable.',
    color: 'yellow', art: 'heart',
    image: 'projects/krillion.png', imageAlt: 'A bright pink pixel-art krill', imageScale: 1.45,
    url: 'https://github.com/cmyksoda/Krillion-Zen',
  },
  {
    title: 'Coaster Ranker',
    description: 'Rank your favorite roller coasters two at a time, without chasing the “right” opinion. Import your credit list and build a top 10, top 50, or full ranking. Expanded from a Claude Artifact made by a friend of a friend, now including an expansive image database.',
    color: 'pink', art: 'sparkles',
    image: 'projects/coaster-ranker.png', imageAlt: 'Coaster Ranker C/R logo',
    url: 'https://coasters.cmyksoda.cc/',
  },
  {
    title: 'Animal Crossing Desktop Clock Plasmoid',
    description: 'I brought the [original Animal Crossing desktop clock](https://archive.org/details/AnimalCrossingDesktopClock), rediscovered by [@MrTalida](https://x.com/MrTalida), to Linux as a KDE Plasma widget. Includes a replica of its network test page, plus 24-hour time, the option to turn off the blinking colon, and other new features and settings.',
    color: 'lilac', art: 'disc',
    image: 'projects/animal-crossing-clock.png', imageAlt: 'Animal Crossing desktop clock with circular date and time digits',
    url: 'https://github.com/cmyksoda/AC-Desktop-Clock-Plasmoid',
  },
  {
    title: 'WiiRadio Stream Bridge',
    description: 'Brings modern internet radio to WiiRadio, a long-abandoned Nintendo Wii homebrew app. A simple web interface converts streams into Wii-compatible audio and generates .pls playlists for easy playback.',
    color: 'cyan', art: 'disc',
    image: 'projects/wiiradio-stream-bridge.webp', imageAlt: 'WiiRadio Stream Bridge logo',
    url: 'https://github.com/cmyksoda/wiiradio-stream-bridge',
  },
];
