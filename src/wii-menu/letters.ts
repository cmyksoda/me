import license from '../../LICENSE?raw';

export interface Letter {
  /** The card shows its first six characters; the reader shows it whole. */
  title: string;
  body: string;
  /** Where the card is pinned on the board, in the board's own units. */
  position: [number, number];
  /** A channel's envelope and paper from menu/letterheads/, as a letter's attachment would carry them. */
  letterhead?: string;
}

/** Joins each paragraph into one line for rewrapping; centered headings keep their own lines. */
function paragraphs(text: string): string {
  return text
    .split(/\n\s*\n/)
    .map((block) => {
      const lines = block.split('\n');
      if (lines.every((line) => /^\s{10,}/.test(line))) return lines.map((line) => line.trim()).join('\n');
      return block.replace(/\s+/g, ' ').trim();
    })
    .join('\n\n');
}

export const letters: Letter[] = [
  {
    title: 'Hello!',
    letterhead: 'wii-shop-gift',
    position: [-170, 95],
    body: [
      'Welcome to my Wii Menu! Every channel here is a forwarder I made: a Wii Menu channel that opens a homebrew '
        + 'app from your SD card or USB drive, with its own icon, banner and sound, which you can fully preview '
        + 'in your browser.',
      'All of my forwarder channels are listed here:\ngithub.com/cmyksoda/Wii-Forwarders',
      'Have fun!\ncmyksoda / Jaxi',
    ].join('\n\n'),
  },
  {
    title: 'Notice',
    position: [10, 30],
    body: [
      'Wii, the Wii Menu, and Nintendo\'s own channels, including their graphics, fonts, sounds, and text, belong '
        + 'to Nintendo. They are used here for a fan page that is not affiliated with or endorsed by Nintendo.',
      'The channels on the main Wii Menu are my forwarder channels. They\'re free software under the GNU GPLv3, '
        + 'with full credits in each repository.',
      'The code of this page is free software under the GNU Affero General Public License, version 3. '
        + 'The AGPLv3 letter holds the license in full, and the source is here:\n'
        + 'github.com/cmyksoda/me',
      'Thank you to Tomoeko\'s Wii_Menu_HTML and the wii-ipl decompilation project, whose work made '
        + 'a faithful menu possible, and to RiiConnect24 for preserving the Wii Shop Channel stationery used here.',
    ].join('\n\n'),
  },
  {
    title: 'Mods',
    letterhead: 'wii-shop-returned',
    position: [160, -35],
    body: [
      'The SD Card Menu holds three channels that aren\'t forwarders. They\'re mods of Nintendo\'s own channels, '
        + 'made for USA Wii consoles.',
      'Super Mario Bros. 25th Anniversary, which shows a 25 on its ? blocks, came pre-installed on the anniversary '
        + 'Wii consoles in Japan, Hong Kong, Taiwan and Australia. North America never got it, so this version '
        + 'combines the English banner from the Australian release with the 60 Hz ROM from the Japanese release.',
      'The Internet Channel runs the Wii port of NetSurf that quatric and I made together, packed entirely '
        + 'inside the channel. It\'s for the Wii only, not the Wii U\'s vWii. Installing it replaces your '
        + 'Internet Channel.',
      'The Forecast Channel is the WiiLink version, redrawn with the Japanese weather symbols everywhere, on the '
        + 'Wii Menu icon too. The icon also shows the current temperature, weather symbol and conditions, and '
        + 'WiiLink\'s logo in place of Weathernews\'. Installing it replaces your Forecast Channel.',
      'Please back up your NAND before you install any of these channels.\ncmyksoda / Jaxi',
    ].join('\n\n'),
  },
  {
    title: 'AGPLv3',
    position: [175, 110],
    body: paragraphs(license),
  },
];
