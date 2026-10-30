"""nw4r's note playback: the envelope generator and the channel that drives an AX voice.

Arithmetic mirrors the retail code's single-precision steps, because the envelope's
table lookups cross index boundaries on one-ulp differences.
"""

from __future__ import annotations

from ax_math import MICROTONES_PER_SEMITONE, f32

ATTACK, DECAY, SUSTAIN, RELEASE = range(4)
VOLUME_FLOOR = f32(-904.0)  # the envelope counts in 0.1 dB steps, down from silence
MS_PER_UPDATE = 3
UNSET = 0xFF  # a track parameter that leaves the instrument's own value alone


def release_rate(setting):
    """EnvGenerator::CalcRelease: 0.1 dB per millisecond for decay and release settings."""
    if setting == 127:
        return f32(65535.0)
    if setting == 126:
        return f32(24.0)
    if setting < 50:
        return f32(f32(f32(setting * 2 + 1) / 128.0) / 5.0)
    return f32(f32(f32(60.0) / (126 - setting)) / 5.0)


class Envelope:
    def __init__(self, tables):
        self.tables = tables
        self.set_all(127, 127, 127, 127)

    def set_all(self, attack, decay, sustain, release):
        self.set_attack(attack)
        self.set_decay(decay)
        self.sustain = sustain
        self.set_release(release)
        self.value = VOLUME_FLOOR
        self.status = ATTACK

    def set_attack(self, setting):
        self.attack = self.tables.attack[setting]

    def set_decay(self, setting):
        self.decay = release_rate(setting)

    def set_release(self, setting):
        self.release = release_rate(setting)

    def ratio(self):
        """EnvGenerator::GetValue: the envelope's loudness as a linear gain."""
        if self.status == ATTACK and self.attack == 0.0:
            return self.tables.volume_ratio(0.0)
        return self.tables.volume_ratio(f32(self.value / 10.0))

    def update(self, milliseconds):
        if self.status == ATTACK:
            for _ in range(milliseconds):
                self.value = f32(self.value * self.attack)
                if self.value > -f32(1.0 / 32.0):
                    self.value = f32(0.0)
                    self.status = DECAY
            milliseconds = 0
            if self.status != DECAY:
                return
        if self.status == DECAY:
            floor = float(self.tables.sustain[self.sustain])
            self.value = f32(self.value - f32(self.decay * milliseconds))
            if self.value <= floor:
                self.value = f32(floor)
                self.status = SUSTAIN
        elif self.status == RELEASE:
            self.value = f32(self.value - f32(self.release * milliseconds))


class Channel:
    """One sounding note (nw4r::snd::detail::Channel)."""

    def __init__(self, tables, voice, track, key, original_key, init_volume, init_pan, tune, length):
        self.tables = tables
        self.voice = voice
        self.track = track
        self.key = key
        self.original_key = original_key
        self.init_volume = init_volume
        self.init_pan = init_pan
        self.tune = tune
        self.length = length  # ticks left before release; -1 holds until the wave ends
        self.envelope = Envelope(tables)
        self.user_volume = 1.0
        self.user_pitch = 0.0
        self.user_pitch_ratio = 1.0
        self.user_pan = 0.0
        self.main_send = 0.0
        self.fx_send = [0.0, 0.0, 0.0]
        self.stopped = False

    def release(self):
        self.envelope.status = RELEASE

    def stop(self):
        self.stopped = True

    def update(self):
        """Channel::Update, once per 3 ms: derive the voice's parameters and step the envelope."""
        volume = f32(f32(1.0 * self.init_volume) * self.user_volume)
        envelope_start = self.envelope.ratio()
        if self.envelope.status == RELEASE and f32(volume * envelope_start) == 0.0:
            self.stop()
            return
        semitones = f32(f32(f32(self.key - self.original_key) + 0.0) + self.user_pitch)
        pitch = self.tables.pitch_ratio(int(f32(MICROTONES_PER_SEMITONE * semitones)))
        pitch = f32(pitch * f32(f32(1.0 * self.tune) * self.user_pitch_ratio))
        pan = f32(f32(0.0 + self.init_pan) + self.user_pan)
        self.envelope.update(MS_PER_UPDATE)
        voice = self.voice
        voice.volume = clamp_unit(volume)
        voice.envelope_start = clamp_unit(envelope_start)
        voice.envelope_target = clamp_unit(self.envelope.ratio())
        voice.pitch = pitch
        voice.pan = max(-1.0, min(1.0, pan))
        voice.main_send = clamp_unit(f32(f32(0.0 + self.main_send) + 1.0))
        voice.aux_send = clamp_unit(f32(0.0 + self.fx_send[0]))


def clamp_unit(value):
    return max(0.0, min(1.0, value))
