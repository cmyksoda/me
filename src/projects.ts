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
    color: 'cyan',
    image: 'projects/wii-forwarders.webp',
    imageAlt: 'The Wii Menu, with cmyksoda\'s forwarder channels in its slots',
    url: 'wii-forwarders/',
  },
  {
    title: 'Wii Homebrew Apps',
    color: 'pink',
    image: 'projects/wii-homebrew.webp',
    imageAlt: 'The Homebrew Channel, listing cmyksoda\'s Wii homebrew apps',
    url: 'wii-homebrew/',
  },
  {
    title: 'Colorful Wii Menu Themes',
    color: 'lilac',
    image: 'projects/wii-themes.webp',
    imageAlt: 'The Colorful Wii Menu Themes page, with Piink, ten more colors and a rainbow to choose from',
    url: 'wii-themes/',
  },
];

export const projects: Project[] = [
  {
    title: 'Viola',
    description: 'A desktop and mobile app for using Claude Code on API credits. Made for Max and Ultra subscribers to get the most out of their monthly credits while working like they normally would. Comes with a live credits counter and a collection of themes, even a Windows 95 one.',
    color: 'yellow', art: 'flower',
    image: 'projects/viola.svg', imageAlt: 'Viola icon: a white eight-petal flower on a terracotta rounded square',
    url: 'https://github.com/cmyksoda/Viola',
  },
  {
    title: 'Savepoint',
    description: 'A cute, simple Android app for keeping your place in your games. Organize your now-playing into shelves, keep a backlog of games to play later, and track your play history with the Play Log. Counts Pokémon shiny hunts, too. Your library lives on your phone, so there\'s no account to make. <3',
    color: 'pink', art: 'heart',
    image: 'projects/savepoint.svg', imageAlt: 'Savepoint icon: a pink handheld game console with a white heart on its screen, on a midnight blue and plum circle',
    url: 'https://github.com/cmyksoda/Savepoint',
  },
  {
    title: 'Nightlight',
    description: 'An Android dream journal you speak into as you wake. Recordings go to your own computer over [Tailscale](https://tailscale.com), where they\'re transcribed and read by the coding agent you already use, like Claude Code or Codex. It notices recurring patterns, and can help you learn to lucid dream, if you\'d like. <3',
    color: 'lilac', art: 'sparkles',
    image: 'projects/nightlight.svg', imageAlt: 'Nightlight icon: a pale crescent moon and a small four-point star on a deep indigo night sky',
    url: 'https://github.com/cmyksoda/Nightlight',
  },
  {
    title: 'MiiKit',
    description: 'A C library that lets Wii homebrew apps read, edit, and draw Miis, the way official Wii games do. Miis are drawn in 3D with the Wii\'s own faces and bodies, read straight from the console. Started as sdk/mii in [hbc-reborn](https://github.com/Monsterray/hbc-reborn), and [MiiKit Demo](https://github.com/cmyksoda/MiiKit-Demo) shows it running. Public domain (CC0).',
    color: 'cyan', art: 'flower',
    image: 'projects/miikit.png', imageAlt: 'A smiling Mii in an orange shirt, drawn by MiiKit',
    url: 'https://github.com/cmyksoda/MiiKit',
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
    description: 'Inspired by the official RiiTube service, this is a LAN version for WiiMC-SS. Search YouTube, prepare a video on your server, and watch a complete, seekable copy on the Wii. Videos are saved on your home server/computer and are able to be rewatched or deleted at any time.',
    color: 'cyan', art: 'window',
    image: 'projects/riitube-at-home.svg', imageDark: 'projects/riitube-at-home-dark.svg', imageAlt: 'RiiTube logo', imageWidth: 180,
    url: 'https://github.com/cmyksoda/RiiTube-at-Home',
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
];
