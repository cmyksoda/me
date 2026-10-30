export type Project = {
  title: string;
  /** Supports inline *emphasis* and [links](https://example.com). */
  description: string;
  color: 'pink' | 'cyan' | 'lilac' | 'yellow';
  art: 'flower' | 'orbit' | 'window' | 'heart' | 'disc' | 'sparkles';
  /** Path relative to public/. Empty uses the emoji or illustrated fallback. */
  image: string;
  imageAlt: string;
  /** Shown instead of `image` in dark mode, for art that would vanish on a dark card. */
  imageDark?: string;
  roundedImage?: boolean;
  /** Display zoom for icons with transparent padding. */
  imageScale?: number;
  imageOffset?: [number, number];
  imageWidth?: number;
  emoji?: string;
  url: string;
};

/** A whole subpage of the site, shown by a capture of the page itself. */
export type Room = {
  title: string;
  description: string;
  color: Project['color'];
  /** Path relative to public/, a 16:9 capture of the room. */
  image: string;
  imageAlt: string;
  /** Path of the subpage, relative to the homepage. */
  url: string;
};

export const rooms: Room[] = [
  {
    title: 'Wii Forwarder Channels',
    description: 'Every forwarder channel I\'ve released, on a Wii Menu.',
    color: 'cyan',
    image: 'projects/wii-forwarders.webp',
    imageAlt: 'The Wii Menu, with cmyksoda\'s forwarder channels in its slots',
    url: 'wii-forwarders/',
  },
  {
    title: 'Wii Homebrew Apps',
    description: 'My homebrew apps for the Wii, in the Homebrew Channel.',
    color: 'pink',
    image: 'projects/wii-homebrew.webp',
    imageAlt: 'The Homebrew Channel, listing cmyksoda\'s Wii homebrew apps',
    url: 'wii-homebrew/',
  },
];

export const projects: Project[] = [
  {
    title: 'Tanka',
    description: 'Work-in-progress. An operating system based on Haiku, the free and open-source spiritual successor to BeOS. Runs natively on the Nintendo Wii, using [ActionRetro\'s Tabby for PowerPC](https://github.com/ActionRetro/Tabby-PPC) as a baseline.',
    color: 'lilac', art: 'window',
    image: 'projects/tanka.png', imageAlt: 'Tanka logo', roundedImage: true,
    url: 'https://github.com/cmyksoda/Tanka',
  },
  {
    title: 'Sump.Stream',
    description: '24/7 synchronous broadcast of (almost) every sump on YouTube. Why? Sump.\nVideos collected through extensive sump-related YouTube searches are shuffled daily using a shared seed. The current time determines where everyone tunes into the broadcast. The site is fully static, with no broadcast server to run.',
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
    image: 'projects/animal-crossing-clock.png', imageAlt: 'Animal Crossing desktop clock with circular date and time digits', imageScale: 1.17, imageOffset: [-6, -2],
    url: 'https://github.com/cmyksoda/AC-Desktop-Clock-Plasmoid',
  },
  {
    title: 'RiiTube at Home',
    description: 'Inspired by the official RiiTube service, this is a LAN version for WiiMC-SS. It isn\'t a replacement for RiiTube. Search YouTube, prepare a video on your server, and watch a complete, seekable copy on the Wii.',
    color: 'cyan', art: 'window',
    image: 'projects/riitube-at-home.svg', imageDark: 'projects/riitube-at-home-dark.svg', imageAlt: 'RiiTube logo', imageWidth: 180,
    url: 'https://github.com/cmyksoda/RiiTube-at-Home',
  },
];
