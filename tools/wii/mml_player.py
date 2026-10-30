"""nw4r's sequence player: MML tracks, the tick clock and the note commands that drive channels.

This follows MmlParser, SeqTrack and SeqPlayer from the System Menu's sound library.
Commands the System Menu's sequences do not use raise instead of being guessed at.
"""

from __future__ import annotations

import operator

from ax_math import f32
from nw4r_channel import UNSET

TICK_THRESHOLD = 416  # SeqPlayer's tempo counter: one tick per this much accumulated tempo
DEFAULT_TEMPO = 120
TRACK_COUNT = 16
CALL_DEPTH = 3
VARIABLES = 16
UNSET_VARIABLE = -1

# MML command bytes
WAIT, PROGRAM, OPEN_TRACK, JUMP, CALL = 0x80, 0x81, 0x88, 0x89, 0x8A
RANDOM_ARGUMENT, VARIABLE_ARGUMENT, EXECUTE_IF = 0xA0, 0xA1, 0xA2
PAN, TRACK_VOLUME, PLAYER_VOLUME = 0xC0, 0xC1, 0xC2
TRANSPOSE, PITCH_BEND, BEND_RANGE = 0xC3, 0xC4, 0xC5
PRIORITY, NOTE_WAIT, TIE = 0xC6, 0xC7, 0xC8
ATTACK, DECAY, SUSTAIN, RELEASE, LOOP_START, TRACK_VOLUME_2 = 0xD0, 0xD1, 0xD2, 0xD3, 0xD4, 0xD5
PRINT_VARIABLE, SURROUND_PAN, LOW_PASS = 0xD6, 0xD7, 0xD8
SEND_A, SEND_B, MAIN_SEND = 0xD9, 0xDA, 0xDB
INIT_PAN, MUTE, SEND_C = 0xDC, 0xDD, 0xDE
EXTENDED, TEMPO = 0xF0, 0xE1
LOOP_END, RETURN, ALLOC_TRACK, END = 0xFC, 0xFD, 0xFE, 0xFF

UNSUPPORTED = {
    0xC9: "portamento", 0xCE: "portamento", 0xCF: "portamento",
    0xCA: "LFO", 0xCB: "LFO", 0xCC: "LFO", 0xCD: "LFO", 0xE0: "LFO",
    0xE3: "sweep", MUTE: "muting",
}  # fmt: skip
IGNORED = {PRIORITY, PRINT_VARIABLE, SURROUND_PAN}  # nothing in a lone sound's stereo output
SEND_SLOTS = {SEND_A: 0, SEND_B: 1, SEND_C: 2}

# extended commands (0xF0 xx): arithmetic on a variable, and comparisons that set the "if" flag
ARITHMETIC = {0x81: operator.add, 0x82: operator.sub, 0x83: operator.mul,
              0x87: operator.and_, 0x88: operator.or_, 0x89: operator.xor}  # fmt: skip
COMPARISONS = {0x90: operator.eq, 0x91: operator.ge, 0x92: operator.gt,
               0x93: operator.le, 0x94: operator.lt, 0x95: operator.ne}  # fmt: skip


class UnsupportedSequence(Exception):
    """A sequence uses a command this renderer does not model."""


def signed(value, bits):
    value &= (1 << bits) - 1
    return value - (1 << bits) if value >> (bits - 1) else value


def pan_offset(argument):
    """A pan command's value as the track stores it: 0 and 1 are nudged up before centering."""
    return argument + (argument <= 1) - 64


class Track:
    """One MML track (SeqTrack plus MmlSeqTrack): its parser position and controller values."""

    def __init__(self, player, index):
        self.player = player
        self.index = index
        self.data = player.data
        self.address = None  # None until a sequence is assigned to this track
        self.visited = {}  # address -> tick of the first command read there
        self.channels = []
        self.variables = [UNSET_VARIABLE] * VARIABLES
        self.call_stack = []  # (return or loop address, loop count or None)
        self.wait = 0
        self.note_finish_wait = False
        self.note_wait, self.tie, self.compare = True, False, True
        self.program, self.transpose = 0, 0
        self.volume, self.volume_2, self.pan, self.init_pan = 127, 127, 0, 0
        self.pitch_bend, self.bend_range = 0, 2
        self.main_send, self.sends = 127, [0, 0, 0]
        self.adsr = {ATTACK: UNSET, DECAY: UNSET, SUSTAIN: UNSET, RELEASE: UNSET}

    # -- reading -----------------------------------------------------------------------

    def read_byte(self):
        value = self.data[self.address]
        self.address += 1
        return value

    def read_16(self):
        return self.read_byte() << 8 | self.read_byte()

    def read_24(self):
        return self.read_16() << 8 | self.read_byte()

    def read_variable_length(self):
        value = 0
        while True:
            byte = self.read_byte()
            value = value << 7 | byte & 0x7F
            if not byte & 0x80:
                return value

    def read_argument(self, mode, kind):
        if mode == VARIABLE_ARGUMENT:
            return self.variable(self.read_byte())
        if mode == RANDOM_ARGUMENT:
            low, high = signed(self.read_16(), 16), signed(self.read_16(), 16)
            self.player.randomized.append((low, high))
            return (low + high) // 2  # the System Menu draws from [low, high]; render the middle
        return {"u8": self.read_byte, "s16": self.read_16, "vlq": self.read_variable_length}[kind]()

    def variable(self, index):
        owner, slot = self.variable_slot(index)
        return owner[slot]

    def variable_slot(self, index):
        """Variables 0-15 belong to the player, 16-31 are global, 32-47 belong to this track."""
        if index < VARIABLES:
            return self.player.variables, index
        if index < 2 * VARIABLES:
            return self.player.global_variables, index - VARIABLES
        if index < 3 * VARIABLES:
            return self.variables, index - 2 * VARIABLES
        raise UnsupportedSequence(f"variable {index} does not exist")

    # -- ticks -------------------------------------------------------------------------

    def update_channel_length(self):
        for channel in self.channels:
            if channel.length > 0:
                channel.length -= 1
                if channel.length == 0:
                    channel.release()

    def parse_next_tick(self):
        """SeqTrack::ParseNextTick; True once the track has ended."""
        if self.note_finish_wait:
            if self.channels:
                return False
            self.note_finish_wait = False
        if self.wait > 0:
            self.wait -= 1
            if self.wait > 0:
                return False
        if self.address is not None:
            while self.wait == 0 and not self.note_finish_wait:
                if self.parse():
                    return True
        return False

    def parse(self):
        """MmlParser::Parse: one command or note; True at the end of the track."""
        self.visited.setdefault(self.address, self.player.tick)
        command = self.read_byte()
        execute, mode = True, None
        if command == EXECUTE_IF:
            command = self.read_byte()
            execute = self.compare
        if command == RANDOM_ARGUMENT:
            command, mode = self.read_byte(), RANDOM_ARGUMENT
        if command == VARIABLE_ARGUMENT:
            command, mode = self.read_byte(), VARIABLE_ARGUMENT
        if command < 0x80:
            return self.parse_note(command, execute, mode)
        group = command & 0xF0
        if group == 0x80:
            self.parse_flow(command, execute, mode)
        elif group in (0xC0, 0xD0):
            argument = self.read_argument(mode, "u8")
            if execute:
                if command in (TRANSPOSE, PITCH_BEND):
                    argument = signed(argument, 8)
                self.run_command(command, argument)
        elif group in (0xB0, 0x90):
            if execute:
                self.run_command(command, 0)
        elif group == 0xE0:
            argument = signed(self.read_argument(mode, "s16"), 16)
            if execute:
                self.run_command(command, argument)
        elif command == END:
            return True
        elif command == EXTENDED:
            self.parse_extended(execute, mode)
        elif command != ALLOC_TRACK and execute:
            self.run_command(command, 0)
        return False

    def parse_note(self, key, execute, mode):
        velocity = self.read_byte()
        length = self.read_argument(mode, "vlq")
        if not execute:
            return False
        self.note_on(max(0, min(127, key + self.transpose)), velocity, length if length > 0 else -1)
        if self.note_wait:
            self.wait = length
            if length == 0:
                self.note_finish_wait = True
        return False

    def parse_flow(self, command, execute, mode):
        if command == WAIT:
            ticks = self.read_argument(mode, "vlq")
            if execute:
                self.wait = ticks
        elif command == PROGRAM:
            program = self.read_argument(mode, "vlq")
            if execute:
                self.program = program & 0xFFFF
        elif command == OPEN_TRACK:
            index, address = self.read_byte(), self.read_24()
            if execute:
                self.player.open_track(self, index, address)
        elif command in (JUMP, CALL):
            address = self.read_24()
            if execute:
                self.jump(address, command == CALL)

    def parse_extended(self, execute, mode):
        kind = self.read_byte()
        group = kind & 0xF0
        if group == 0xE0:
            self.read_argument(mode, "s16")
        elif group in (0x80, 0x90):
            variable = self.read_byte()
            argument = signed(self.read_argument(mode, "s16"), 16)
            if execute:
                self.run_extended(kind, variable, argument)

    def jump(self, address, is_call):
        if is_call:
            if len(self.call_stack) >= CALL_DEPTH:
                return
            self.call_stack.append((self.address, None))
        elif address <= self.address:
            self.player.loop_events.append((self.index, self.visited.get(address), self.player.tick))
        self.address = address

    # -- controllers -------------------------------------------------------------------

    def run_command(self, command, argument):
        if command in UNSUPPORTED:
            raise UnsupportedSequence(f"{UNSUPPORTED[command]} (command {command:#x}) is not modeled")
        if command in IGNORED:
            return
        if command == TEMPO:
            self.player.tempo = argument
        elif command == PAN:
            self.pan = pan_offset(argument)
        elif command == INIT_PAN:
            self.init_pan = pan_offset(argument)
        elif command == TRACK_VOLUME:
            self.volume = argument
        elif command == TRACK_VOLUME_2:
            self.volume_2 = argument
        elif command == PLAYER_VOLUME:
            self.player.volume = argument
        elif command == TRANSPOSE:
            self.transpose = argument
        elif command == PITCH_BEND:
            self.pitch_bend = argument
        elif command == BEND_RANGE:
            self.bend_range = argument
        elif command == NOTE_WAIT:
            self.note_wait = bool(argument)
        elif command == TIE:
            self.tie = bool(argument)
            self.release_all()
            self.channels = []
        elif command in self.adsr:
            self.adsr[command] = argument
        elif command in SEND_SLOTS:
            self.sends[SEND_SLOTS[command]] = argument
        elif command == MAIN_SEND:
            self.main_send = argument
        elif command == RETURN and self.call_stack:
            self.address = self.call_stack.pop()[0]
        elif command == LOOP_START and len(self.call_stack) < CALL_DEPTH:
            self.call_stack.append((self.address, argument))
        elif command == LOOP_END:
            self.end_loop()
        elif command == LOW_PASS and argument != 64:
            raise UnsupportedSequence("the low-pass filter is not modeled")

    def end_loop(self):
        if not self.call_stack:
            return
        address, count = self.call_stack[-1]
        if count and count - 1 == 0:
            self.call_stack.pop()
        else:
            if count:
                self.call_stack[-1] = (address, count - 1)
            self.address = address

    def run_extended(self, kind, variable, argument):
        owner, slot = self.variable_slot(variable)
        value = owner[slot]
        if kind in COMPARISONS:
            self.compare = COMPARISONS[kind](value, argument)
            return
        if kind == 0x80:
            value = argument
        elif kind in ARITHMETIC:
            value = ARITHMETIC[kind](value, argument)
        elif kind == 0x84 and argument:
            value = int(value / argument)
        elif kind == 0x85:
            value = value << argument if argument >= 0 else value >> -argument
        elif kind == 0x8A:
            value = ~(argument & 0xFFFF)
        elif kind == 0x8B and argument:
            value = value - argument * int(value / argument)
        elif kind not in (0x84, 0x8B):
            raise UnsupportedSequence(f"extended command {kind:#x}")
        owner[slot] = signed(value, 16)

    # -- notes -------------------------------------------------------------------------

    def release_all(self):
        self.update_channel_params()
        for channel in self.channels:
            channel.release()

    def note_on(self, key, velocity, length):
        channel = self.channels[-1] if self.tie and self.channels else None
        if channel is not None:
            channel.key = key
            level = f32(velocity / 127.0)
            channel.init_volume = f32(level * level)
        else:
            channel = self.player.engine.start_note(self, key, velocity, -1 if self.tie else length)
            if channel is None:
                return
            self.channels.append(channel)
        for command, setter in ((ATTACK, "set_attack"), (DECAY, "set_decay"), (RELEASE, "set_release")):
            if self.adsr[command] != UNSET:
                getattr(channel.envelope, setter)(self.adsr[command])
        if self.adsr[SUSTAIN] != UNSET:
            channel.envelope.sustain = self.adsr[SUSTAIN]

    def update_channel_params(self):
        """SeqTrack::UpdateChannelParam: pass the controller values on to the sounding notes."""
        player = self.player
        volume = f32(1.0)
        for part in (self.volume, self.volume_2, player.volume):
            ratio = f32(part / 127.0)
            volume = f32(volume * f32(ratio * ratio))
        volume = f32(f32(volume * 1.0) * player.sound_volume)
        pitch = f32(f32(self.pitch_bend / 128.0) * self.bend_range)
        pan = f32(max(-1.0, min(1.0, f32(self.pan / 63.0))))
        pan = f32(f32(pan * 1.0) + player.pan)
        main_send = f32(f32(f32(self.main_send / 127.0) - 1.0) + 0.0)
        sends = [f32(f32(0.0 + f32(send / 127.0)) + 0.0) for send in self.sends]
        for channel in self.channels:
            channel.user_volume = volume
            channel.user_pitch = pitch
            channel.user_pan = pan
            channel.main_send = main_send
            channel.fx_send = sends


class SequencePlayer:
    """SeqPlayer: the tick clock and the tracks one sound allocates."""

    def __init__(
        self, engine, data, start, track_mask, bank_id, sound_volume, global_variables, pan=0.0
    ):
        self.engine = engine
        self.data = data
        self.bank_id = bank_id
        self.sound_volume = sound_volume
        self.pan = f32(pan)
        self.tempo = DEFAULT_TEMPO
        self.volume = 127
        self.tempo_counter = TICK_THRESHOLD
        self.tick = 0
        self.variables = [UNSET_VARIABLE] * VARIABLES
        self.global_variables = global_variables
        self.randomized = []
        # one (track, tick the target was first read, tick of the jump) per backward jump
        self.loop_events = []
        self.tracks = {i: Track(self, i) for i in range(TRACK_COUNT) if track_mask >> i & 1}
        self.tracks[0].address = start
        self.active = True

    def open_track(self, caller, index, address):
        track = self.tracks.get(index)
        if track is not None and track is not caller:
            track.release_all()
            track.channels = []
            track.address = address

    def update(self):
        """SeqPlayer::Update, once per 3 ms."""
        if self.active:
            for _ in range(self.advance_tempo_counter()):
                if self.parse_next_tick():
                    self.finish()
                    break
                self.tick += 1
        for track in self.tracks.values():
            track.update_channel_params()

    def advance_tempo_counter(self):
        ticks = self.tempo_counter // TICK_THRESHOLD
        self.tempo_counter -= ticks * TICK_THRESHOLD
        self.tempo_counter += int(f32(self.tempo))
        return ticks

    def parse_next_tick(self):
        """True when no track is left to play."""
        alive = False
        for index in sorted(self.tracks):
            track = self.tracks[index]
            track.update_channel_length()
            if track.parse_next_tick():
                self.close_track(index)
            else:
                alive = alive or track.address is not None
        return not alive

    def close_track(self, index):
        track = self.tracks.pop(index)
        track.release_all()
        track.channels = []

    def finish(self):
        for index in list(self.tracks):
            self.close_track(index)
        self.active = False
