"""Write decoded sound as FLAC, which browsers decode losslessly, so loop points stay exact."""

from __future__ import annotations

import shutil
import subprocess
import sys
from array import array
from pathlib import Path


def interleave(channels):
    """One little-endian signed 16-bit byte string, frames in channel order."""
    count = len(channels[0])
    mixed = array("h", bytes(2 * count * len(channels)))
    for index, channel in enumerate(channels):
        mixed[index :: len(channels)] = array("h", channel)
    if sys.byteorder == "big":
        mixed.byteswap()
    return mixed.tobytes()


def write_flac(path, channels, sample_rate):
    """Encode 16-bit channels with ffmpeg; no metadata, so a rerun writes identical bytes."""
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg is None:
        raise RuntimeError("ffmpeg is needed to write FLAC")
    command = [
        ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
        "-f", "s16le", "-ar", str(sample_rate), "-ac", str(len(channels)), "-i", "-",
        "-map_metadata", "-1", "-fflags", "+bitexact", "-c:a", "flac", "-compression_level", "12",
        str(path),
    ]  # fmt: skip
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(command, input=interleave(channels), check=True)
