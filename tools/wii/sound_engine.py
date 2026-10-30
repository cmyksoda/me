"""Play one archive sound offline, the way the System Menu's sound thread plays it.

Every 3 ms the engine runs the same steps as nw4r's SoundThreadProc: sequence players tick,
channels update, voices pick up their parameters, then the DSP mixes 96 samples.
"""

from __future__ import annotations

from array import array
from collections import deque
from dataclasses import dataclass, field

from ax_math import f32
from ax_reverb import ReverbHi
from ax_voice import FRAME, OUTPUT_RATE, AxVoice, Buses, WaveStream
from mml_player import SequencePlayer
from nw4r_channel import Channel
from rsar import Bank, SequenceFile

AUX_LATENCY = 2  # frames between a voice's aux send and the effect's return reaching the mix
DETECTION_LATENCY = 2  # frames before the CPU sees that a voice ran off the end of its wave
SILENT_FRAMES_TO_STOP = 40  # longer than any delay line in the effect
MAX_FRAMES = OUTPUT_RATE * 60 // FRAME


@dataclass
class Rendered:
    left: array
    right: array
    still_playing: bool  # the sound had not ended when rendering stopped
    randomized: list = field(default_factory=list)  # (low, high) of every random controller read
    loop_events: list = field(default_factory=list)
    tick_frames: dict = field(default_factory=dict)  # tick number -> frame it ran in

    @property
    def frames(self):
        return len(self.left)


class SoundEngine:
    def __init__(self, archive, tables, converter_banks, linear=False):
        self.archive = archive
        self.tables = tables
        self.converter_banks = converter_banks
        self.linear = linear
        self._banks, self._sequences = {}, {}
        self.reset()

    def reset(self):
        """Silence, with an empty effect: the state every sound is rendered from."""
        self.players = []
        self.channels = []
        self.note_waves = {"mono": 0, "stereo": 0}  # notes started so far, by the wave they play
        self.frame = 0
        self.finish_visible = {}
        self.reverb = ReverbHi(self.tables.reverb_delays, self.tables.reverb_preset)
        self.returns = deque([([0] * FRAME, [0] * FRAME)] * AUX_LATENCY)

    # -- starting things ---------------------------------------------------------------

    def bank(self, bank_id):
        if bank_id not in self._banks:
            self._banks[bank_id] = Bank(self.archive, self.archive.bank_location(bank_id))
        return self._banks[bank_id]

    def sequence_file(self, sound):
        if sound.file_id not in self._sequences:
            location = self.archive.location(sound.file_id)
            self._sequences[sound.file_id] = SequenceFile(self.archive, location)
        return self._sequences[sound.file_id]

    def start_sequence(self, sound, pan=0.0):
        """Begin a sequence sound (SoundArchivePlayer::PrepareSeqImpl)."""
        data = self.archive.data[self.sequence_file(sound).base :]
        volume = f32(sound.volume / 127.0)
        player = SequencePlayer(
            self, data, sound.start, sound.track_mask, sound.bank_id, volume, [-1] * 16, pan
        )
        self.players.append(player)
        return player

    def start_note(self, track, key, velocity, length):
        """Bank::NoteOn: pick the instrument region and start a channel for it."""
        region = self.bank(track.player.bank_id).region(track.program, key, velocity)
        if region is None:
            return None
        wave = self.bank(track.player.bank_id).wave(region.wave_index)
        self.note_waves["stereo" if len(wave.pcm) == 2 else "mono"] += 1
        loop_passes = wave.loop_pcm if wave.loop else [None] * len(wave.pcm)
        streams = [WaveStream(first, loop) for first, loop in zip(wave.pcm, loop_passes)]
        voice = AxVoice(streams, wave.sample_rate, self.converter_banks, self.linear)
        level = f32(velocity / 127.0)
        init_volume = f32(f32(level * level) * f32(region.volume / 127.0))
        init_pan = f32(f32((region.pan - 64) / 63.0) + f32(track.init_pan / 63.0))
        channel = Channel(
            self.tables, voice, track, key, region.root_key, init_volume, init_pan, region.tune, length
        )
        channel.envelope.set_all(region.attack, region.decay, region.sustain, region.release)
        self.channels.append(channel)
        return channel

    def render_wave(self, wave, volume):
        """A wave sound with default parameters: one voice at full envelope, nothing on the effect."""
        streams = [WaveStream(pcm) for pcm in wave.pcm]
        voice = AxVoice(streams, wave.sample_rate, self.converter_banks, self.linear)
        voice.volume = volume
        voice.envelope_start = voice.envelope_target = 1.0
        left, right = array("h"), array("h")
        while voice.running:
            voice.prepare_frame(self.tables)
            buses = Buses()
            voice.process_frame(buses)
            left.extend(map(clamp_sample, buses.main_left))
            right.extend(map(clamp_sample, buses.main_right))
        return [left, right]

    # -- one 3 ms step -----------------------------------------------------------------

    def step(self):
        for player in self.players:
            player.update()
        for channel in list(self.channels):
            channel.update()
            if channel.stopped:
                self.drop(channel)
        for channel in list(self.channels):
            visible_at = self.finish_visible.get(channel)
            if visible_at is not None and visible_at <= self.frame:
                self.drop(channel)
            else:
                channel.voice.prepare_frame(self.tables)
        buses = Buses()
        for channel in self.channels:
            voice = channel.voice
            if voice.running:
                voice.process_frame(buses)
                if not voice.running:
                    self.finish_visible[channel] = self.frame + DETECTION_LATENCY
        returned_left, returned_right = self.returns.popleft()
        self.returns.append(self.reverb.process(buses.aux_left, buses.aux_right))
        self.frame += 1
        return (
            [clamp_sample(a + b) for a, b in zip(buses.main_left, returned_left)],
            [clamp_sample(a + b) for a, b in zip(buses.main_right, returned_right)],
        )

    def drop(self, channel):
        self.channels.remove(channel)
        self.finish_visible.pop(channel, None)
        if channel in channel.track.channels:
            channel.track.channels.remove(channel)

    # -- running a sound to its end ----------------------------------------------------

    def render(self, max_frames=MAX_FRAMES, stop_when=None):
        """Run until the sequence has ended and everything it started has gone quiet.

        `stop_when(engine)` ends the run early; it is how looping music is cut at a loop point.
        """
        left, right = array("h"), array("h")
        tick_frames = {}
        quiet = 0
        player = self.players[0]
        while self.frame < max_frames:
            first_tick = player.tick
            block_left, block_right = self.step()
            for tick in range(first_tick, player.tick):
                tick_frames[tick] = self.frame - 1
            left.extend(block_left)
            right.extend(block_right)
            if stop_when is not None and stop_when(self):
                break
            silent = not any(block_left) and not any(block_right)
            quiet = quiet + 1 if silent else 0
            if not player.active and not self.channels and quiet >= SILENT_FRAMES_TO_STOP:
                break
        return Rendered(
            left,
            right,
            still_playing=player.active or bool(self.channels),
            randomized=player.randomized,
            loop_events=player.loop_events,
            tick_frames=tick_frames,
        )


def clamp_sample(value):
    return max(-0x8000, min(0x7FFF, value))
