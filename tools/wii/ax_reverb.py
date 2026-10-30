"""The System Menu's auxiliary-A effect: AXFX ReverbHi in the configuration System::initFx picks.

Fused mode 0 with no early reflections and no pre-delay: three feedback combs and two
all-passes feed a low-pass and a last all-pass, once per channel. The surround channel
carries nothing in stereo output, so it is left out. Arithmetic is double precision
where the retail code uses single precision.
"""

from __future__ import annotations

from ax_voice import OUTPUT_RATE

COMB_COUNT, ALLPASS_COUNT = 3, 2
LOW_PASS_LIMIT = 0.95
OUTPUT_SCALE = 0.6  # ReverbHi's fused gain of 0.6 before the preset's own output gain


class ReverbChannel:
    """The filter chain for one side."""

    def __init__(self, comb_lengths, allpass_lengths, last_length):
        self.combs = [[0.0] * length for length in comb_lengths]
        self.allpasses = [[0.0] * length for length in allpass_lengths]
        self.last = [0.0] * last_length
        self.comb_positions = [0] * COMB_COUNT
        self.allpass_positions = [0] * ALLPASS_COUNT
        self.last_position = 0
        self.low_pass_state = 0.0


class ReverbHi:
    def __init__(self, delays, preset):
        """`delays` and `preset` come from the System Menu: the filter lengths, then
        pre-delay, time, coloration, damping, crosstalk and output gain."""
        pre_delay, time, coloration, damping, crosstalk, gain = preset
        if pre_delay or crosstalk:
            raise ValueError("pre-delay and crosstalk are not modeled")
        comb_lengths = delays[:COMB_COUNT]
        self.comb_gains = [10.0 ** (length * -3.0 / (time * OUTPUT_RATE)) for length in comb_lengths]
        self.allpass_gain = coloration
        self.smoothing = min(LOW_PASS_LIMIT, 1.0 - damping)
        self.output_gain = OUTPUT_SCALE * gain
        allpass_lengths = delays[COMB_COUNT : COMB_COUNT + ALLPASS_COUNT]
        self.sides = [
            ReverbChannel(comb_lengths, allpass_lengths, delays[COMB_COUNT + ALLPASS_COUNT + side])
            for side in range(2)
        ]

    def process(self, left, right):
        """One frame in and out, as integer lists."""
        return self.run(self.sides[0], left), self.run(self.sides[1], right)

    def run(self, side, samples):
        combs, allpasses, last = side.combs, side.allpasses, side.last
        comb_positions, allpass_positions = side.comb_positions, side.allpass_positions
        last_position = side.last_position
        coloration, smoothing, gain = self.allpass_gain, self.smoothing, self.output_gain
        state = side.low_pass_state
        output = []
        for sample in samples:
            total = 0.0
            for index in range(COMB_COUNT):
                line, position = combs[index], comb_positions[index]
                held = line[position]
                line[position] = sample + held * self.comb_gains[index]
                total += held
                comb_positions[index] = position + 1 if position + 1 < len(line) else 0
            for index in range(ALLPASS_COUNT):
                line, position = allpasses[index], allpass_positions[index]
                held = line[position]
                written = total + held * coloration
                line[position] = written
                total = held - written * coloration
                allpass_positions[index] = position + 1 if position + 1 < len(line) else 0
            state = (1.0 - smoothing) * total + smoothing * state
            held = last[last_position]
            written = state + held * coloration
            last[last_position] = written
            output.append(int((held - written * coloration) * gain))
            last_position = last_position + 1 if last_position + 1 < len(last) else 0
        side.last_position = last_position
        side.low_pass_state = state
        return output
