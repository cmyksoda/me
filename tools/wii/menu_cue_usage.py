"""Where the System Menu starts each IplSound cue, from the 4.3 decompilation (koopthekoopa/wii-ipl).

Paths are under src/. The menu starts cues by name; "held" cues are restarted every
frame while the control is held and stop a frame after the last restart.
"""

USES = {
    # channel grid
    "WIPL_SE_WII_START": [
        "start-up phrase, played with the music when the grid first appears (scene/channelSelect)"
    ],
    "WIPL_BGM_MENU": [
        "channel grid music: starts with the start-up phrase, stops when a channel is clicked (five "
        "steps of 1/60 s: gain 0.8, 0.6, 0.4, 0.2, 0) and starts again from the top about 0.5 s "
        "after the Wii Menu button is pressed in the preview (scene/channelSelect; confirmed in a "
        "Dolphin capture)"
    ],
    "WIPL_SE_CH_TARGETTING": [
        "pointer enters a channel tile, or an empty slot while a channel is held"
    ],
    "WIPL_SE_BT_TARGETTING": [
        "pointer enters any button: footer buttons, page arrows, preview and board buttons, dialog buttons, links"
    ],
    "WIPL_SE_BT_PUSH": [
        "click on a channel tile (the music fades out as the zoom starts)",
        "the Wii Menu button in a channel preview, in the same frame as WIPL_SE_CH_UNSELECT",
        "A on the Health and Safety screen",
        "trash button in a letter",
    ],
    "WIPL_SE_CH_SELECT": [
        "channel preview zoom-in begins, 0.07 to 0.2 s after the click once the banner has loaded; "
        "the banner sound starts 0.48 s later"
    ],
    "WIPL_SE_CH_UNSELECT": ["channel preview zoom-out begins (Wii Menu button), with WIPL_SE_BT_PUSH"],
    "WSD_SELECT": [
        "grid page arrows and edge drag-scroll",
        "previous/next channel arrows in a preview",
        "previous/next day on the Message Board",
        "keyboard page change",
    ],
    "WIPL_SE_DECIDE": [
        "Message Board and Wii Settings footer buttons",
        "Start in a channel preview",
        "confirm buttons in dialogs",
    ],
    "WIPL_SE_GRAY_BUTTON": [
        "press on a disabled button (Start when a channel cannot run, Message Board in safe mode)"
    ],
    "WIPL_SE_CH_HOLD": [
        "B grabs a channel; its pan comes from the raw -1 to 1 pointer position, so it stays near center"
    ],
    "WIPL_SE_CH_DRAG": [
        "held while a grabbed channel moves: volume = min(1, 2 * distance / 304), pitch = distance / 30 "
        "above 30 px per frame, pan = x / 304"
    ],
    "WIPL_SE_CH_SET": [
        "a grabbed channel is dropped into a free slot; pan = pointer x / projection half-width "
        "(-0.21 and +0.20 in the Dolphin capture)"
    ],
    "WIPL_SE_CH_NOT_MOVE": [
        "a grabbed channel is dropped where it cannot go; pan = pointer x / projection half-width"
    ],
    "WIPL_SE_BALLOON": [
        "a text balloon pops up about 0.3 s after the pointer lands on a channel tile or a button that has "
        "one (Wii, SD card, Message Board; Calendar, Create and Wii Menu on the board); none on the page "
        "arrows or in a preview"
    ],
    "WIPL_SE_NEW_ARRIVAL": [
        "new-mail jingle on the Message Board button, every 3 seconds while unread"
    ],
    "WIPL_SE_SDCARD_IN": ["SD card inserted (grid SD button)"],
    "WIPL_SE_SDCARD_OUT": ["SD card removed (grid SD button)"],
    # Message Board
    "WIPL_SE_BOARD_FOCUS": ["pointer enters a letter"],
    "WIPL_SE_BOARD_HOLD": ["B grabs a letter; pan = letter x / projection half-width"],
    "WIPL_SE_BOARD_RELEASE": ["a grabbed letter is released; pan = letter x / projection half-width"],
    "WIPL_SE_BOARD_DRAG": ["held while a grabbed letter moves, like WIPL_SE_CH_DRAG"],
    "WIPL_SE_MSG_DISP": ["a letter appears on the board; pan = letter x / projection half-width"],
    "WIPL_SE_MSG_HOUSE": [
        "letters leave when the day changes; pan = +300 or -300 over the projection half-width"
    ],
    "WIPL_SE_BOARD_SELECT": ["a letter is opened"],
    "WIPL_SE_BOARD_UNSELECT": ["a letter is closed with its Back button"],
    "WIPL_SE_BOARD_DUMP": ["a letter is deleted"],
    "WIPL_SE_PIC_ZOOM_IN": ["a letter's picture is enlarged"],
    "WIPL_SE_PIC_ZOOM_OUT": ["a letter's picture is closed"],
    "WIPL_SE_MESSAGE_SCROLL": ["held while text scrolls by more than a pixel (utility/iplUtility, keyboard)"],
    "WIPL_SE_B_SCROLL": [
        "a tick for every 128 units scrolled while the B button auto-scrolls text (BScroller)"
    ],
    "WIPL_SE_CALENDAR_SCROLL": ["calendar month scroll, face picker scroll"],
    "WIPL_SE_DATE_SELECT": ["a day is picked in the calendar"],
    "WIPL_SE_DATE_FOCUS": ["pointer enters a calendar date"],
    # dialogs and settings
    "WIPL_SE_CANCEL": ["cancel/back buttons in Wii Settings, the calendar, dialogs"],
    "WIPL_SE_INFO_WINDOW": ["an information dialog opens"],
    "WIPL_SE_COPYING": [
        "a copy or move begins; loops until the menu stops it (iplChannelEdit, iplDialogWindow)"
    ],
    "WIPL_SE_COPY_FINISH": ["a copy, move or delete finishes"],
    "WIPL_SE_ERROR": ["error beep; never restarted while it plays (System::startSE)"],
    "WIPL_SE_CHOICE_CHG": ["not started by name in the decompilation"],
    "WIPL_SE_OUTPUT_MODE_SELECT": ["not started by name in the decompilation"],
    "WIPL_SE_FL_PAGE_INC": ["not started by name in the decompilation"],
    "WIPL_SE_FL_PAGE_DEC": ["not started by name in the decompilation"],
    # banner jingles
    "WIPL_ME_NO_DISC_BANNER": ["Disc Channel preview with no disc inserted"],
    "WIPL_ME_GC_BANNER": ["Disc Channel preview with a GameCube disc"],
    "WIPL_ME_INVALID_DISC_BANNER": ["Disc Channel preview with a disc the Wii cannot read"],
    "WIPL_ME_SD_BANNER": ["SD Card channel preview"],
    "WIPL_ME_VIRTUAL_CONSOLE": ["not started by name anywhere in the decompilation"],
    # software keyboard
    "WIPL_SE_SK_OPEN": ["keyboard opens"],
    "WIPL_SE_SK_CANCEL_CLOSE": ["keyboard closed with Cancel"],
    "WIPL_SE_SK_DECIDE_CLOSE": ["keyboard closed with OK (same audio as WIPL_SE_DECIDE)"],
    "WIPL_SE_SK_PAGE_CHG": ["not started by name; the same wave as WSD_SELECT"],
    "WIPL_SE_SK_SWITCHING_01": ["keyboard switches back from mobile-phone input"],
    "WIPL_SE_SK_SWITCHING_02": ["keyboard language switch, or switch to mobile-phone input"],
    "WIPL_SE_SK_SWITCH_TO_KETAI": ["keyboard switches to mobile-phone input"],
    "WIPL_SE_SK_PREDICT_ON": ["predictive text turned on"],
    "WIPL_SE_SK_PREDICT_OFF": ["predictive text turned off"],
    "WIPL_SE_CHAR_FOCUS": ["pointer enters a key"],
    "WIPL_SE_CHAR_CURSOR": ["text cursor moves"],
    "WIPL_SE_CHAR_CURSOR_FIX": ["text cursor placed"],
    "WIPL_SE_CHAR_DELETE": ["delete key; pitch bend varies per press"],
    "WIPL_SE_CHAR_DELETE_ERROR": ["delete key with nothing to delete"],
    "WIPL_SE_CHAR_INPUT": ["character typed; pitch bend varies per press"],
    "WIPL_SE_CHAR_DECIDE": ["decide key; pitch bend varies per press"],
    "WIPL_SE_LINE_SCROLL": ["text field scrolls a line"],
    "WIPL_SE_SYMBOL_PAGE_OPEN": ["symbol or language page opens"],
    "WIPL_SE_CHAR_LARGER": ["shift to capitals"],
    "WIPL_SE_CHAR_LOWER": ["shift to lowercase"],
    # HOME Menu
    "HOMESE_HOME_BUTTON": ["HOME Menu opens"],
    "HOMESE_RETURN_APP": ["HOME Menu closes back to the application"],
    "HOMESE_GOTO_MENU": ["Wii Menu chosen in the HOME Menu"],
    "HOMESE_RESET_APP": ["Reset chosen in the HOME Menu"],
    "HOMESE_FOCUS": ["pointer enters a HOME Menu button"],
    "HOMESE_SELECT": ["HOME Menu button pressed"],
    "HOMESE_CANCEL": ["HOME Menu back or cancel"],
    "HOMESE_OPEN_CONTROLLER": ["Wii Remote Settings opens"],
    "HOMESE_CLOSE_CONTROLLER": ["Wii Remote Settings closes"],
    "HOMESE_VOLUME_PLUS": ["speaker volume up"],
    "HOMESE_VOLUME_MINUS": ["speaker volume down"],
    "HOMESE_VOLUME_PLUS_LIMIT": ["speaker volume already at its maximum"],
    "HOMESE_VOLUME_MINUS_LIMIT": ["speaker volume already at its minimum"],
    "HOMESE_NOTHING_DONE": ["a press that does nothing"],
    "HOMESE_VIBE_ON": ["rumble turned on"],
    "HOMESE_VIBE_OFF": ["rumble turned off"],
    "HOMESE_START_CONNECT_WINDOW": ["controller connect window opens"],
    "HOMESE_CONNECTED": ["player 1 controller connected"],
    "HOMESE_CONNECTED2": ["player 2 controller connected"],
    "HOMESE_CONNECTED3": ["player 3 controller connected"],
    "HOMESE_CONNECTED4": ["player 4 controller connected"],
    "HOMESE_END_CONNECT_WINDOW": ["controller connect window closes"],
}  # fmt: skip
