import license from '../../LICENSE?raw';

export interface Letter {
  /** The card shows its first six characters; the reader shows it whole. */
  title: string;
  body: string;
  /** Where the card is pinned on the board, in the board's own units. */
  position: [number, number];
}

/** Paragraphs separated by blank lines, each joined into one line for rewrapping. */
function paragraphs(text: string): string {
  return text
    .split(/\n\s*\n/)
    .map((block) => block.replace(/\s+/g, ' ').trim())
    .join('\n\n');
}

export const letters: Letter[] = [
  {
    title: 'Hello!',
    position: [-170, 95],
    body: [
      'Welcome to my Wii Menu! Every channel here is a forwarder I made: a little Wii Menu channel '
        + 'that opens a homebrew app from your SD card, with its own icon, banner and sound.',
      'Click a channel to see its banner, then Download to visit its repository on GitHub. '
        + 'Hold the right mouse button on a channel to carry it to another slot, like holding A and B '
        + 'on a Wii Remote.',
      'All of my forwarder channels are listed here:\nhttps://github.com/cmyksoda/Wii-Forwarders',
      'Have fun!\njaxi',
    ].join('\n\n'),
  },
  {
    title: 'Notice',
    position: [10, 30],
    body: [
      'Wii and the Wii Menu, including its graphics, fonts, sounds and text, belong to Nintendo. '
        + 'They are used here for a fan page that is not affiliated with or endorsed by Nintendo.',
      'Each channel\'s icon, banner and sound come from my forwarder channels, which are free software '
        + 'under the GNU GPLv3, with full credits in each repository.',
      'The code of this page is free software under the GNU Affero General Public License, version 3. '
        + 'You can read it in full in the next letter, and find the source here:\n'
        + 'https://github.com/cmyksoda/me',
      'Thank you to Tomoeko\'s Wii_Menu_HTML and the wii-ipl decompilation project, whose work made '
        + 'a faithful menu possible.',
    ].join('\n\n'),
  },
  {
    title: 'AGPLv3',
    position: [175, 110],
    body: paragraphs(license),
  },
];
