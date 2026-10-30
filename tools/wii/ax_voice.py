"""One AX voice: what the Wii's audio DSP does with a playing wave, 3 ms (96 samples) at a time.

Voices read a wave through the sample-rate converter, scale it by a ramping volume
envelope, then add it to the main and auxiliary-A buses. All arithmetic past the
converter is the DSP's integer arithmetic.
"""

from __future__ import annotations

import struct
from pathlib import Path

from ax_math import f32

FRAME = 96
OUTPUT_RATE = 32000
UNITY = 0x8000  # AX_MAX_VOLUME: a mix coefficient of 1.0
ENVELOPE_MAX = UNITY - 1
PHASES = 128
BANK_WORDS = PHASES * 4

# Where Dolphin keeps the DSP coefficient ROM dump the 4-tap converter filters with.
DSP_COEF_LOCATIONS = (
    "~/.local/share/dolphin-emu/Sys/GC/dsp_coef.bin",
    "/usr/share/dolphin-emu/sys/GC/dsp_coef.bin",
    "/usr/local/share/dolphin-emu/sys/GC/dsp_coef.bin",
)


def find_dsp_coef(path=None):
    """The dsp_coef.bin to filter with: the given path, else the first Dolphin install that has one."""
    candidates = [Path(path)] if path else [Path(p).expanduser() for p in DSP_COEF_LOCATIONS]
    return next((c for c in candidates if c.is_file() and c.stat().st_size == 4096), None)


def load_converter_banks(path):
    """The three 4-tap filter banks (each 128 phases of 4 taps) from a dsp_coef.bin."""
    words = struct.unpack(">2048h", Path(path).read_bytes())
    return [
        [tuple(words[bank * BANK_WORDS + phase * 4 :][:4]) for phase in range(PHASES)]
        for bank in range(3)
    ]


def converter_bank_for(banks, wave_rate):
    """nw4r picks the filter from the wave's own rate: 8k above 4/3, 12k above 1, else 16k."""
    ratio = f32(f32(1.0 * wave_rate) / OUTPUT_RATE)
    if ratio > f32(4.0 / 3.0):
        return banks[0]
    return banks[1] if ratio > 1.0 else banks[2]


class WaveStream:
    """One channel of a wave as the accelerator feeds it: the first pass, then the loop section."""

    def __init__(self, first_pass, loop_pass=None):
        self.samples = [0, 0, 0, 0, *first_pass]  # four zeros: the converter's empty history
        self.length = len(first_pass)
        self.loop_pass = list(loop_pass) if loop_pass else None

    def reach(self, index):
        """Extend the buffer so `index` can be read; a plain end reads as silence."""
        shortfall = index + 1 - len(self.samples)
        if shortfall <= 0:
            return
        if self.loop_pass is None:
            self.samples.extend([0] * shortfall)
            return
        while len(self.samples) <= index:
            self.samples.extend(self.loop_pass)

    @property
    def loops(self):
        return self.loop_pass is not None


class Converter:
    """AX sample-rate conversion for one stream, with the DSP's 16.16 fixed-point position."""

    def __init__(self, stream, bank):
        self.stream = stream
        self.bank = bank  # None selects the DSP's linear interpolation
        self.consumed = 0
        self.fraction = 0

    @property
    def finished(self):
        """The accelerator has read the last sample of a wave that does not loop."""
        return not self.stream.loops and self.consumed >= self.stream.length

    def run(self, ratio):
        """Produce one frame of converted samples, advancing the fixed-point read position."""
        stream = self.stream
        stream.reach(self.consumed + ((self.fraction + FRAME * ratio) >> 16) + 3)
        convert = self._polyphase if self.bank else self._linear
        return convert(stream.samples, ratio)

    def _polyphase(self, samples, ratio):
        bank, consumed, position = self.bank, self.consumed, self.fraction
        output = []
        for _ in range(FRAME):
            position += ratio
            consumed += position >> 16
            position &= 0xFFFF
            c0, c1, c2, c3 = bank[position >> 9]
            value = (
                samples[consumed] * c0
                + samples[consumed + 1] * c1
                + samples[consumed + 2] * c2
                + samples[consumed + 3] * c3
            ) >> 15
            output.append(max(-0x8000, min(0x7FFF, value)))
        self.consumed, self.fraction = consumed, position
        return output

    def _linear(self, samples, ratio):
        consumed, position = self.consumed, self.fraction
        output = []
        for _ in range(FRAME):
            position += ratio
            consumed += position >> 16
            position &= 0xFFFF
            oldest = samples[consumed]
            if position:
                oldest = (oldest * (0x10000 - position) + samples[consumed + 1] * position) >> 16
            output.append(oldest)
        self.consumed, self.fraction = consumed, position
        return output


class Buses:
    """The DSP's per-frame accumulators: main left/right and auxiliary A left/right."""

    def __init__(self):
        self.main_left = [0] * FRAME
        self.main_right = [0] * FRAME
        self.aux_left = [0] * FRAME
        self.aux_right = [0] * FRAME


def mix_into(bus, samples, coefficient):
    if coefficient:
        for index, sample in enumerate(samples):
            bus[index] += (sample * coefficient) >> 15


class AxVoice:
    """A playing wave: one converter per channel, sharing a volume envelope and pitch."""

    def __init__(self, waves, wave_rate, banks, linear=False):
        self.wave_rate = wave_rate
        bank = None if linear or banks is None else converter_bank_for(banks, wave_rate)
        self.converters = [Converter(wave, bank) for wave in waves]
        self.channel_count = len(waves)
        # Parameters the CPU side sets every frame (Channel::Update).
        self.volume = 1.0
        self.envelope_start = 0.0
        self.envelope_target = 1.0
        self.pitch = 1.0
        self.pan = 0.0
        self.main_send = 1.0
        self.aux_send = 0.0
        self.previous_volume = None
        self.running = True
        self.fixed_ratio = 0
        self._envelope = (0, 0)
        self._mixes = []

    # -- CPU side: AxVoice::UpdateAxSrc / UpdateAxVe / UpdateAxMix --------------------

    def prepare_frame(self, tables):
        ratio = f32(f32(self.pitch * self.wave_rate) / OUTPUT_RATE)
        self.fixed_ratio = int(f32(65536.0 * ratio))
        volume = self.volume
        start_volume = volume if self.previous_volume is None else self.previous_volume
        start = int(f32(f32(start_volume * self.envelope_start) * ENVELOPE_MAX))
        target = int(f32(f32(volume * self.envelope_target) * ENVELOPE_MAX))
        self._envelope = (start, int((target - start) / FRAME))
        self.previous_volume = volume
        self._mixes = [self._channel_mix(index, tables) for index in range(self.channel_count)]

    def _channel_mix(self, index, tables):
        side = 0.0 if self.channel_count == 1 else (-1.0 if index == 0 else 1.0)
        pan = f32(self.pan + side)
        left, right = tables.pan_ratio(pan), tables.pan_ratio(-pan)
        return (
            coefficient(f32(left * self.main_send)),
            coefficient(f32(right * self.main_send)),
            coefficient(f32(left * self.aux_send)),
            coefficient(f32(right * self.aux_send)),
        )

    # -- DSP side: ProcessVoice -------------------------------------------------------

    def process_frame(self, buses):
        start, step = self._envelope
        for converter, (main_l, main_r, aux_l, aux_r) in zip(self.converters, self._mixes):
            samples = converter.run(self.fixed_ratio)
            leveled = [(s * (start + i * step)) >> 15 for i, s in enumerate(samples)]
            mix_into(buses.main_left, leveled, main_l)
            mix_into(buses.main_right, leveled, main_r)
            mix_into(buses.aux_left, leveled, aux_l)
            mix_into(buses.aux_right, leveled, aux_r)
        if all(converter.finished for converter in self.converters):
            self.running = False


def coefficient(gain):
    """CalcAXPBMIX: a gain becomes a 16-bit mix coefficient."""
    return min(0xFFFF, int(f32(gain * UNITY)))
