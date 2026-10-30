"""Single-precision arithmetic and the System Menu's audio lookup tables.

The Wii sound driver computes in float32, so results are rounded after every
operation. Its lookup tables are read from the user's own 4.3U executable
instead of being embedded here.
"""

from __future__ import annotations

import hashlib
import math
import struct
from dataclasses import dataclass
from pathlib import Path

USA_43_EXECUTABLE_SHA256 = "47b9c1bb0ba1890256fb368b1b3272e33ea2467feadf39d20ce469d6de6e6c43"

SEMITONES_PER_OCTAVE = 12
MICROTONES_PER_SEMITONE = 256
MICROTONES_PER_OCTAVE = SEMITONES_PER_OCTAVE * MICROTONES_PER_SEMITONE
VOLUME_MIN_DB = -90.4
VOLUME_MAX_DB = 6.0
VOLUME_TABLE_ZERO = 904  # index of 0 dB in the 0.1 dB decibel table

_FLOAT = struct.Struct("<f")


def f32(value):
    """Round a Python float to the nearest float32."""
    return _FLOAT.unpack(_FLOAT.pack(value))[0]


def clamp(value, low, high):
    return max(low, min(high, value))


def read_dol_range(data, address, size):
    """Read a virtual address range that lies inside one DOL section."""
    for index in range(18):
        offset = struct.unpack_from(">I", data, index * 4)[0]
        start = struct.unpack_from(">I", data, 0x48 + index * 4)[0]
        length = struct.unpack_from(">I", data, 0x90 + index * 4)[0]
        if length and start <= address and address + size <= start + length:
            begin = offset + address - start
            return data[begin : begin + size]
    raise ValueError(f"address {address:#x} is outside the executable's sections")


@dataclass(frozen=True)
class NativeTables:
    attack: tuple  # 128 envelope attack multipliers per millisecond
    sustain: tuple  # 128 sustain levels in 0.1 dB
    decibels: tuple  # 965 volume ratios, 0.1 dB steps from -90.4 to +6 dB
    pan: tuple  # 257 square-root pan-law gains
    note_ratios: tuple  # 12 semitone ratios within an octave
    microtone_ratios: tuple  # 256 ratios within a semitone
    reverb_delays: tuple  # ReverbHi delay-line lengths (fused mode 0)
    reverb_preset: tuple  # pre-delay, time, coloration, damping, crosstalk, gain
    source_sha256: str

    def volume_ratio(self, decibels):
        """Util::CalcVolumeRatio: clamp, then truncate to a table index."""
        decibels = clamp(decibels, f32(VOLUME_MIN_DB), VOLUME_MAX_DB)
        return self.decibels[VOLUME_TABLE_ZERO + int(f32(10 * decibels))]

    def pan_ratio(self, pan):
        """Util::CalcPanRatio for a pan position in [-1, 1]."""
        position = f32(f32(clamp(pan, -1.0, 1.0) + 1.0) / 2.0)
        return self.pan[int(f32(f32(position * 256) + 0.5))]

    def pitch_ratio(self, microtones):
        """Util::CalcPitchRatio: a pitch offset in 1/256 semitones becomes a playback ratio."""
        octave, rest = divmod(microtones, MICROTONES_PER_OCTAVE)
        note, microtone = divmod(rest, MICROTONES_PER_SEMITONE)
        ratio = 2.0**octave
        if note:
            ratio = f32(ratio * self.note_ratios[note])
        if microtone:
            ratio = f32(ratio * self.microtone_ratios[microtone])
        return ratio


def load_native_tables(path) -> NativeTables:
    data = Path(path).read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    if digest != USA_43_EXECUTABLE_SHA256:
        raise ValueError(
            "the audio tables are read from the USA System Menu 4.3 executable; "
            f"{path} has SHA-256 {digest}"
        )

    def floats(address, count):
        return struct.unpack(f">{count}f", read_dol_range(data, address, count * 4))

    return NativeTables(
        attack=floats(0x8161E3F0, 128),
        sustain=struct.unpack(">128h", read_dol_range(data, 0x8161E2F0, 256)),
        decibels=floats(0x8161EAD8, 965),
        pan=floats(0x8161F9EC, 257),
        note_ratios=tuple(f32(math.pow(2, note / SEMITONES_PER_OCTAVE)) for note in range(12)),
        microtone_ratios=tuple(
            f32(math.pow(2, step / MICROTONES_PER_OCTAVE)) for step in range(MICROTONES_PER_SEMITONE)
        ),
        reverb_delays=struct.unpack(">8I", read_dol_range(data, 0x81685DA0, 32)),
        reverb_preset=floats(0x8160F048, 6),
        source_sha256=digest,
    )
