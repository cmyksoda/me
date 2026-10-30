"""Nintendo DSP ADPCM, decoded the way the Wii's audio accelerator reads it.

Eight bytes hold fourteen samples: a header byte (predictor, scale) and seven bytes of
signed nibbles. A stream is addressed in nibbles, two header nibbles to every frame.
"""

from __future__ import annotations

from array import array
from dataclasses import dataclass

SAMPLES_PER_FRAME = 14
NIBBLES_PER_FRAME = 16
BYTES_PER_FRAME = 8
SAMPLE_LIMIT = 0x7FFF  # the accelerator saturates symmetrically


@dataclass(frozen=True)
class AdpcmContext:
    """The decoder state a voice is started, or looped, with."""

    coefficients: tuple  # eight predictor pairs, 16 values
    pred_scale: int
    yn1: int
    yn2: int
    loop_pred_scale: int = 0
    loop_yn1: int = 0
    loop_yn2: int = 0


def nibble_to_sample(address):
    return address // NIBBLES_PER_FRAME * SAMPLES_PER_FRAME + address % NIBBLES_PER_FRAME - 2


def _filter(coefficients, pred_scale):
    pair = (pred_scale >> 4) & 7
    return coefficients[pair * 2], coefficients[pair * 2 + 1], 1 << (pred_scale & 15)


def decode_samples(data, first, count, coefficients, pred_scale, yn1, yn2):
    """Decode `count` samples starting at sample index `first`.

    The starting predictor and scale come from the caller, because a voice that starts or
    loops mid-frame never sees that frame's header. Later headers are read from `data`;
    bytes past its end read as zero.
    """
    data = bytes(data) + bytes(2 * BYTES_PER_FRAME)
    coef1, coef2, scale = _filter(coefficients, pred_scale)
    samples = array("h")
    for index in range(first, first + count):
        frame, slot = divmod(index, SAMPLES_PER_FRAME)
        if slot == 0 and index != first:
            coef1, coef2, scale = _filter(coefficients, data[frame * BYTES_PER_FRAME])
        packed = data[frame * BYTES_PER_FRAME + 1 + slot // 2]
        nibble = packed >> 4 if slot % 2 == 0 else packed & 15
        if nibble >= 8:
            nibble -= 16
        sample = nibble * scale + ((0x400 + coef1 * yn1 + coef2 * yn2) >> 11)
        sample = max(-SAMPLE_LIMIT, min(SAMPLE_LIMIT, sample))
        samples.append(sample)
        yn2, yn1 = yn1, sample
    return samples


def decode_first_pass(data, last_sample, context):
    """Samples 0 through `last_sample` (the end address is inclusive)."""
    return decode_samples(
        data, 0, last_sample + 1, context.coefficients, context.pred_scale, context.yn1, context.yn2
    )


def decode_loop_pass(data, loop_start, last_sample, context):
    """One pass of the loop section, started the way the accelerator restarts it.

    Its history comes from the loop context, not from the samples that came before,
    so it can differ from the first pass over the same range.
    """
    return decode_samples(
        data,
        loop_start,
        last_sample - loop_start + 1,
        context.coefficients,
        context.loop_pred_scale,
        context.loop_yn1,
        context.loop_yn2,
    )
