#!/usr/bin/env python3
"""Turn a channel's banner sound (meta/sound.bin) into FLAC plus a small JSON.

The Wii Menu plays the file three ways, and this follows each as the retail 4.3U
menu does: BNS (DSP ADPCM) through its own AX voice, RIFF WAV and AIFF through a
software wave player. The retail menu's quirks are kept (see the notes each run prints)
unless --ideal asks for a plain decode of the file instead.

    convert_channel_sound.py public/wii-forwarders/channels/*/sound.bin
    convert_channel_sound.py --banner 00000000.app      (reads meta/sound.bin inside)
"""

from __future__ import annotations

import argparse
import hashlib
import json
import struct
import sys
from array import array
from dataclasses import dataclass, field, replace
from pathlib import Path

from dsp_adpcm import AdpcmContext, decode_first_pass, decode_loop_pass
from sound_files import write_flac

MIN_RATE, MAX_RATE = 4000, 48000  # the menu rejects anything outside this
BANNER_VOLUME = 0.9  # System::initOnMemory: sBannerSoundPlayer.setMasterVolume(0.9)
CENTER_PAN_GAIN = 0.7071067690849304  # a mono wave through the menu's sqrt pan law
U8_MAGIC = b"\x55\xaa\x38\x2d"


class RejectedSound(ValueError):
    """A file the Wii Menu itself would refuse to play."""


@dataclass
class ChannelSound:
    channels: list  # one array('h') per channel
    sample_rate: int
    source: str
    gain: float
    loop_start: int | None = None  # frames in the exported audio
    loop_end: int | None = None
    quirks: list = field(default_factory=list)

    @property
    def frames(self):
        return len(self.channels[0])


# --- containers -------------------------------------------------------------------


def unwrap(blob, quirks):
    """Strip the IMD5 header and any LZ77 or Yaz0 packing, as the menu's file loader does."""
    if blob[:4] == b"IMD5":
        length = struct.unpack_from(">I", blob, 4)[0]
        payload = blob[32 : 32 + length]
        if hashlib.md5(payload).digest() != blob[16:32]:
            quirks.append("IMD5 checksum does not match; the Wii Menu would drop this sound")
        blob = payload
    if blob[:4] == b"LZ77":
        return unwrap(decompress_lz77(blob[4:]), quirks)
    if blob[:4] == b"Yaz0":
        return unwrap(decompress_yaz0(blob), quirks)
    if blob[:3] in (b"ASH", b"ASR"):
        raise RejectedSound("ASH-compressed sound is not supported")
    return blob


def decompress_lz77(data):
    """CX type 0x10 LZ: a flag byte, MSB first, picks literals or (length, distance) copies."""
    if data[0] != 0x10:
        raise RejectedSound(f"unsupported LZ77 type {data[0]:#x}")
    size = int.from_bytes(data[1:4], "little")
    out, cursor = bytearray(), 4
    while len(out) < size:
        flags = data[cursor]
        cursor += 1
        for bit in range(8):
            if len(out) >= size:
                break
            if flags & (0x80 >> bit):
                high, low = data[cursor], data[cursor + 1]
                cursor += 2
                length = (high >> 4) + 3
                distance = ((high & 15) << 8 | low) + 1
                for _ in range(length):
                    out.append(out[-distance])
            else:
                out.append(data[cursor])
                cursor += 1
    return bytes(out[:size])


def decompress_yaz0(data):
    size = struct.unpack_from(">I", data, 4)[0]
    out, cursor = bytearray(), 16
    while len(out) < size:
        flags = data[cursor]
        cursor += 1
        for bit in range(8):
            if len(out) >= size:
                break
            if flags & (0x80 >> bit):
                out.append(data[cursor])
                cursor += 1
                continue
            high, low = data[cursor], data[cursor + 1]
            cursor += 2
            distance = ((high & 15) << 8 | low) + 1
            length = high >> 4
            if length == 0:
                length = data[cursor] + 0x12
                cursor += 1
            else:
                length += 2
            for _ in range(length):
                out.append(out[-distance])
    return bytes(out)


def find_in_banner(data, wanted="meta/sound.bin"):
    """Pull one file out of an opening.bnr (IMET header, then a U8 archive)."""
    root = data.find(U8_MAGIC, 0, 0x1000)
    if root < 0:
        raise RejectedSound("no U8 archive found in the banner")
    nodes_offset, _, _ = struct.unpack_from(">III", data, root + 4)
    count = struct.unpack_from(">I", data, root + nodes_offset + 8)[0]
    names = root + nodes_offset + count * 12
    path, ends = [], []
    for index in range(1, count):
        kind_name, offset, size = struct.unpack_from(">III", data, root + nodes_offset + index * 12)
        while ends and index >= ends[-1]:
            ends.pop()
            path.pop()
        name_at = names + (kind_name & 0xFFFFFF)
        name = data[name_at : data.index(b"\0", name_at)].decode()
        if kind_name >> 24 == 1:
            path.append(name)
            ends.append(size)
        elif "/".join(path + [name]) == wanted:
            return data[root + offset : root + offset + size]
    raise RejectedSound(f"{wanted} is not in this banner")


# --- BNS --------------------------------------------------------------------------


@dataclass
class BnsStream:
    """What AxAdpcmSimplePlayer reads from a BNS before it starts the voices."""

    rate: int
    looping: bool
    loop_start: int
    loop_end: int  # the sample count; the menu also plays the sample at this index when it loops
    streams: list  # one DSP byte string per channel
    contexts: list  # one AdpcmContext per channel, as the file stores it


def parse_bns(data, quirks):
    """Check the file the way AxAdpcmSimplePlayer::checkFile does, then read its channels."""
    if len(data) < 0x20 or struct.unpack_from(">H", data, 4)[0] != 0xFEFF:
        raise RejectedSound("BNS header: wrong byte order")
    if (len(data) + 31) // 32 != (struct.unpack_from(">I", data, 8)[0] + 31) // 32:
        raise RejectedSound("BNS header: file size does not match")
    info_at, info_size = struct.unpack_from(">II", data, 16)
    data_at, data_size = struct.unpack_from(">II", data, 24)
    if data[info_at : info_at + 4] != b"INFO" or data[data_at : data_at + 4] != b"DATA":
        raise RejectedSound("BNS header: INFO or DATA block missing")
    block_size = struct.unpack_from(">I", data, data_at + 4)[0]
    if block_size != data_size:
        quirks.append(
            f"the DATA block says it is {block_size:#x} bytes, the file header's table says "
            f"{data_size:#x}; the Wii Menu never compares the two, and only trusts the block"
        )
    info = data[info_at + 8 : info_at + info_size]
    fields = struct.unpack_from(">BBB1xH2xIII", info)
    codec, looping, channel_count, rate, loop_start, loop_end, table = fields
    if codec != 0:
        raise RejectedSound(f"BNS codec {codec} is not DSP ADPCM")
    if not MIN_RATE <= rate <= MAX_RATE or channel_count not in (1, 2):
        raise RejectedSound(f"{channel_count} channels at {rate} Hz is outside what the menu plays")
    capacity = block_size * 14 // 8  # the menu's upper bound on the samples in DATA
    if loop_start >= loop_end or capacity <= loop_start or capacity < loop_end:
        raise RejectedSound("BNS loop points are out of range")
    stream = BnsStream(rate, bool(looping), loop_start, loop_end, [], [])
    for channel in range(channel_count):
        entry = struct.unpack_from(">I", info, table + 4 * channel)[0]
        data_offset, context_offset = struct.unpack_from(">II", info, entry)
        coefficients = struct.unpack_from(">16h", info, context_offset)
        history = struct.unpack_from(">HHhhHhh", info, context_offset + 32)[1:]
        stream.streams.append(data[data_at + 8 + data_offset :])
        stream.contexts.append(AdpcmContext(coefficients, *history))
    return stream


def read_bns(data, ideal):
    """A BNS as the menu plays it; with `ideal`, as a plain decoder would."""
    quirks = []
    bns = parse_bns(data, quirks)
    contexts = []
    for channel, (stream, context) in enumerate(zip(bns.streams, bns.contexts)):
        header_scale = stream[0]
        if header_scale != context.pred_scale:
            if ideal:
                context = replace(context, pred_scale=header_scale)
            else:
                quirks.append(
                    f"channel {channel}: the context starts at predictor/scale "
                    f"{context.pred_scale:#04x} but the first frame header says {header_scale:#04x}; "
                    "the DSP starts mid-frame, so it uses the context"
                )
        if not ideal:
            # AxAdpcmSimplePlayer::start copies loop_yn1 over loop_yn2.
            context = replace(context, loop_yn2=context.loop_yn1)
        contexts.append(context)
    # The end address is inclusive, so a loop also plays the sample at index `loop_end`.
    last = bns.loop_end if bns.looping and not ideal else bns.loop_end - 1
    first_pass = [decode_first_pass(s, last, c) for s, c in zip(bns.streams, contexts)]
    sound = ChannelSound(first_pass, bns.rate, "BNS DSP ADPCM", BANNER_VOLUME, quirks=quirks)
    if bns.looping:
        add_loop(sound, bns, contexts, last, ideal)
    return sound


def add_loop(sound, bns, contexts, last, ideal):
    """Set the loop points, storing the loop section a second time when a restart sounds different."""
    first_pass = sound.channels
    loop_pass = [decode_loop_pass(s, bns.loop_start, last, c) for s, c in zip(bns.streams, contexts)]
    tails = [first[bns.loop_start :] for first in first_pass]
    if ideal or tails == loop_pass:
        sound.loop_start, sound.loop_end = bns.loop_start, sound.frames
        return
    changed = max(abs(a - b) for tail, again in zip(tails, loop_pass) for a, b in zip(tail, again))
    sound.quirks.append(
        "each loop restart decodes from the loop context instead of the running history (up to "
        f"{changed} off for a few milliseconds), so the loop section is stored twice: once in the "
        "first pass, once as the repeating pass"
    )
    sound.loop_start = sound.frames
    for channel, again in zip(sound.channels, loop_pass):
        channel.extend(again)
    sound.loop_end = sound.frames


# --- RIFF WAV and AIFF ------------------------------------------------------------


def split_interleaved(samples, channel_count):
    return [samples[index::channel_count] for index in range(channel_count)]


def read_wav(data):
    """RIFF WAV as WaveFileWav::checkFile accepts it: 16-bit PCM, loop from a `smpl` chunk."""
    chunks, cursor = {}, 12
    end = min(len(data), struct.unpack_from("<I", data, 4)[0] + 8)
    while cursor + 8 <= end:
        tag, size = struct.unpack_from("<4sI", data, cursor)
        chunks.setdefault(tag, data[cursor + 8 : cursor + 8 + size])
        cursor += 8 + size + (size & 1)
    if b"fmt " not in chunks or b"data" not in chunks:
        raise RejectedSound("WAV has no fmt or data chunk")
    audio_format, channel_count, rate, _, _, bits = struct.unpack_from("<HHIIHH", chunks[b"fmt "])
    if audio_format != 1 or bits != 16:
        raise RejectedSound("WAV must be 16-bit integer PCM")
    check_player_limits(channel_count, rate)
    samples = array("h")
    samples.frombytes(chunks[b"data"][: len(chunks[b"data"]) // 2 * 2])
    if sys.byteorder == "big":
        samples.byteswap()
    channels = split_interleaved(samples, channel_count)
    sound = ChannelSound(channels, rate, "RIFF WAV PCM 16", gain_for_wave_player(channel_count))
    if b"smpl" in chunks and struct.unpack_from("<I", chunks[b"smpl"], 28)[0] > 0:
        sound.loop_start, last = struct.unpack_from("<II", chunks[b"smpl"], 44)
        sound.loop_end = last + 1
        check_loop(sound)
    return sound


def read_aiff(data):
    """AIFF as WaveFileAiff accepts it: 16-bit PCM, forward loop from the INST and MARK chunks."""
    chunks, cursor = {}, 12
    end = min(len(data), struct.unpack_from(">I", data, 4)[0] + 8)
    while cursor + 8 <= end:
        tag, size = struct.unpack_from(">4sI", data, cursor)
        chunks.setdefault(tag, data[cursor + 8 : cursor + 8 + size])
        cursor += 8 + size + (size & 1)
    if b"COMM" not in chunks or b"SSND" not in chunks:
        raise RejectedSound("AIFF has no COMM or SSND chunk")
    channel_count, frames, bits = struct.unpack_from(">HIH", chunks[b"COMM"])
    if bits != 16:
        raise RejectedSound("AIFF must be 16-bit")
    rate = decode_extended(chunks[b"COMM"][8:18])
    check_player_limits(channel_count, rate)
    offset, block = struct.unpack_from(">II", chunks[b"SSND"])
    if offset or block:
        raise RejectedSound("AIFF sound data must start right after the SSND header")
    samples = array("h")
    samples.frombytes(chunks[b"SSND"][8 : 8 + frames * channel_count * 2])
    if sys.byteorder == "little":
        samples.byteswap()
    channels = split_interleaved(samples, channel_count)
    sound = ChannelSound(channels, rate, "AIFF PCM 16", gain_for_wave_player(channel_count))
    if b"INST" in chunks and struct.unpack_from(">H", chunks[b"INST"], 8)[0] == 1:
        begin_id, end_id = struct.unpack_from(">HH", chunks[b"INST"], 10)
        markers = {}
        count = struct.unpack_from(">H", chunks[b"MARK"])[0]
        cursor = 2
        for _ in range(count):
            marker_id, position, name_length = struct.unpack_from(">HIB", chunks[b"MARK"], cursor)
            markers[marker_id] = position
            cursor += 7 + name_length + ((name_length + 1) & 1)
        sound.loop_start, sound.loop_end = markers[begin_id], markers[end_id]
        check_loop(sound)
    return sound


def decode_extended(raw):
    """AIFF's 80-bit extended sample rate."""
    exponent = struct.unpack_from(">H", raw)[0] & 0x7FFF
    mantissa = int.from_bytes(raw[2:10], "big")
    return round(mantissa * 2.0 ** (exponent - 16383 - 63))


def check_player_limits(channel_count, rate):
    if channel_count not in (1, 2) or not MIN_RATE <= rate <= MAX_RATE:
        raise RejectedSound(f"{channel_count} channels at {rate} Hz is outside what the menu plays")


def check_loop(sound):
    if not 0 <= sound.loop_start < sound.loop_end <= sound.frames:
        raise RejectedSound("loop points fall outside the audio")


def gain_for_wave_player(channel_count):
    """nw4r's wave player pans a mono wave to the center, which the sqrt pan law lowers by 3 dB."""
    return BANNER_VOLUME * (CENTER_PAN_GAIN if channel_count == 1 else 1.0)


# --- output -----------------------------------------------------------------------


def read_sound(blob, ideal=False):
    quirks = []
    data = unwrap(blob, quirks)
    if data[:4] == b"BNS ":
        sound = read_bns(data, ideal)
    elif data[:4] == b"RIFF":
        sound = read_wav(data)
    elif data[:4] == b"FORM":
        sound = read_aiff(data)
    else:
        raise RejectedSound(f"unknown sound format {data[:4]!r}")
    sound.quirks = quirks + sound.quirks
    return sound


def describe(sound):
    rate = sound.sample_rate
    details = {
        "source": sound.source,
        "sampleRate": rate,
        "channels": len(sound.channels),
        "frames": sound.frames,
        "duration": sound.frames / rate,
        "gain": sound.gain,
        "loop": sound.loop_start is not None,
    }
    if sound.loop_start is not None:
        details.update(
            loopStart=sound.loop_start / rate,
            loopEnd=sound.loop_end / rate,
            loopStartFrame=sound.loop_start,
            loopEndFrame=sound.loop_end,
        )
    if sound.quirks:
        details["notes"] = sound.quirks
    return details


def convert(path, banner=False, out_dir=None, ideal=False):
    blob = Path(path).read_bytes()
    if banner:
        blob = find_in_banner(blob)
    sound = read_sound(blob, ideal)
    target = Path(out_dir) if out_dir else Path(path).parent
    stem = "sound" if banner else Path(path).stem
    write_flac(target / f"{stem}.flac", sound.channels, sound.sample_rate)
    (target / f"{stem}.json").write_text(json.dumps(describe(sound), indent=2) + "\n")
    return sound


def parse_arguments():
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("files", nargs="+", type=Path, help="sound.bin files, or banners with --banner")
    parser.add_argument(
        "--banner", action="store_true", help="read meta/sound.bin out of an opening.bnr or .app"
    )
    parser.add_argument("--out", type=Path, help="write here instead of next to each input")
    parser.add_argument(
        "--ideal", action="store_true", help="decode the file as intended, not as the menu plays it"
    )
    return parser.parse_args()


def main():
    args = parse_arguments()
    failed = False
    for path in args.files:
        try:
            sound = convert(path, args.banner, args.out, args.ideal)
        except (RejectedSound, struct.error, IndexError) as error:
            print(f"{path}: {error}", file=sys.stderr)
            failed = True
            continue
        loop = f", loop {sound.loop_start}-{sound.loop_end}" if sound.loop_start is not None else ""
        print(
            f"{path}: {sound.source}, {len(sound.channels)} ch, {sound.sample_rate} Hz, "
            f"{sound.frames} frames{loop}"
        )
        for note in sound.quirks:
            print(f"    note: {note}")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
