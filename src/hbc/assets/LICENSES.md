# Licenses for the Homebrew Channel page's assets

The page's own code is free software under the GNU AGPLv3 (see `LICENSE` at the
repository root). The files in this folder come from other people's work, under
their own licenses.

## The Homebrew Channel's theme graphics

`about.png`, `apps_grid.png`, `apps_grid_hover.png`, `apps_list.png`,
`apps_list_hover.png`, `apps_next.png`, `apps_next_hover.png`, `apps_previous.png`,
`apps_previous_hover.png`, `background.png`, `background_wide.png`, `bubble1.png`,
`bubble2.png`, `bubble3.png`, `button_tiny.png`, `button_tiny_focus.png`,
`content_arrow_down.png`, `content_arrow_up.png`, `cursor_drag.png`,
`cursor_drag_shade.png`, `cursor_pic.png`, `cursor_shade.png`,
`dialog_background.png`, `icon_network.png`, `icon_network_active.png`,
`icon_usbgecko.png`, `icon_usbgecko_active.png`, `logo.png` and `throbber.png`
are unchanged copies of `channel/channelapp/data/` from The Homebrew Channel 1.1.3
(https://github.com/fail0verflow/hbc), Copyright (C) 2007-2012 Team Twiizers.
The theme is "Dark Water" by drmr.

That repository's README says: "Unless otherwise noted in an individual file
header, all source code in this repository is released under the terms of the GNU
General Public License, version 2 or later." The full license text is its
`COPYING` file, and https://www.gnu.org/licenses/old-licenses/gpl-2.0.html.

`info.png`, `info_hover.png`, `view_grid.png`, `view_grid_hover.png`,
`view_list.png` and `view_list_hover.png` are drawn by `tools/hbc/buttons.py` from
`apps_previous.png` and `apps_previous_hover.png`, so they carry the same license.

## Droid Sans

`droid.woff2` and `droidbold.woff2` are subsets of the `droid.ttf` and
`droidbold.ttf` that ship with The Homebrew Channel 1.1.3, made by
`tools/hbc/fonts.sh`. Droid Sans is digitized data copyright (C) 2007 Google
Corporation, designed by Ascender Corporation, and licensed under the Apache
License, Version 2.0 (https://www.apache.org/licenses/LICENSE-2.0). Droid is a
trademark of Google. `../metrics.json` holds FreeType's measurements of the same
fonts.

## App icons

`../icons/*.png` are the icons from each app's latest release on GitHub
(https://github.com/cmyksoda), copied by `tools/hbc/sync_apps.py`. Each one is
under its own repository's license.
