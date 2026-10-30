#!/usr/bin/env python3
"""Extract the Wii System Menu's own sounds from IplSound.brsar as FLAC plus sounds.json.

Wave sounds are decoded bit-exactly from the archive (those not at 32 kHz are then converted
the way the console does). Sequenced sounds are played through a model of nw4r's sequence
player and the Wii's audio DSP (sound_engine.py) and rendered at the console's 32 kHz.
Rerunning rewrites every file with identical bytes.

    python3 tools/wii/extract_sounds.py
    python3 tools/wii/extract_sounds.py --only WIPL_SE_CH_TARGETTING WSD_SELECT
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

from ax_math import f32, load_native_tables
from ax_voice import FRAME, OUTPUT_RATE, find_dsp_coef, load_converter_banks
from menu_cue_usage import USES
from mml_player import UnsupportedSequence
from rsar import Archive, WaveSoundSet
from sound_engine import SoundEngine
from sound_files import write_flac

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_ARCHIVE = ROOT / "project-data/menu-raw/sound/IplSound.brsar"
DEFAULT_EXECUTABLE = ROOT / "project-data/nand-copy/title/00000001/00000002/content/00000098.app"
DEFAULT_OUTPUT = ROOT / "public/wii-forwarders/sound"

MUSIC = "WIPL_BGM_MENU"  # loops through jumps in the sequence, so it is cut at a loop point
CUE_SECONDS = 10  # no finite cue is longer; anything still playing then never ends by itself
SCHEMA = 1


@dataclass
class Context:
    archive: Archive
    tables: object  # ax_math.NativeTables
    engine: SoundEngine


@dataclass
class Exported:
    channels: list  # one array('h') per channel
    sample_rate: int
    gain: float
    rendering: str
    loop: tuple | None = None  # (start frame, end frame) in the exported audio
    notes: list = field(default_factory=list)
    extra: dict = field(default_factory=dict)  # further manifest fields


class Unsupported(Exception):
    """A sound this extractor cannot reproduce faithfully."""


# --- wave sounds ------------------------------------------------------------------


def export_wave(context, sound):
    """Decode the archive's wave, which plays straight through with no sequence or envelope.

    A wave that is not at the console's 32 kHz is exported as the console plays it, converted
    to 32 kHz with the volume applied, because the converter's filter changes how it sounds.
    """
    wave_set = WaveSoundSet(context.archive, context.archive.location(sound.file_id))
    entry = wave_set.entry(sound.start)
    note = entry.notes[0]
    plain = (
        len(entry.notes) == 1
        and (entry.pitch, entry.pan, entry.aux_sends, entry.main_send) == (1.0, 64, (0, 0, 0), 127)
        and (note.attack, note.decay, note.sustain, note.release) == (127, 127, 127, 127)
    )
    wave = wave_set.wave(note.wave_index)
    if not plain or wave.loop:
        raise Unsupported(f"{sound.symbol}: needs voice parameters this export does not model")
    volume = f32(sound.volume / 127.0)
    if wave.sample_rate != OUTPUT_RATE:
        notes = [f"the wave is {wave.sample_rate} Hz; this is the console's 32 kHz conversion of it"]
        channels = context.engine.render_wave(wave, volume)
        return Exported(channels, OUTPUT_RATE, 1.0, "ax-model", notes=notes, extra={"pan": 0.0})
    notes = []
    gain = volume
    if len(wave.pcm) == 1:
        # nw4r pans a mono wave to the center, and its pan law takes 3 dB off each side.
        gain = f32(gain * context.tables.pan_ratio(0.0))
        notes.append("mono wave: gain includes the console's center pan law")
    return Exported(wave.pcm, wave.sample_rate, gain, "wave", notes=notes, extra={"pan": 0.0})


# --- sequenced sounds -------------------------------------------------------------


def trim(rendered, length=None):
    """The two channels, cut to `length` or else without their trailing silence."""
    left, right = rendered.left, rendered.right
    if length is None:
        length = len(left)
        while length and not left[length - 1] and not right[length - 1]:
            length -= 1
    return [left[:length], right[:length]]


def repeating_unit(engine, rendered):
    """(start, length) in samples of audio that repeats exactly, or None.

    The candidates are one loop of a looping wave played at normal speed, and the frames
    a whole number of passes through a sequence loop take.
    """
    candidates = set()
    for channel in engine.channels:
        for converter in channel.voice.converters:
            if converter.stream.loops and channel.voice.fixed_ratio == 0x10000:
                candidates.add(len(converter.stream.loop_pass))
    events = [event for event in rendered.loop_events if event[0] == 0]
    if len(events) >= 2:
        _, first_tick, end_tick = events[0]
        for passes in range(1, 21):
            later = rendered.tick_frames.get(first_tick + passes * (end_tick - first_tick))
            if later is not None:
                candidates.add((later - rendered.tick_frames[first_tick]) * FRAME)
    for length in sorted(candidates):
        for start in (0, length):
            if repeats(rendered, start, length):
                return start, length
    return None


def repeats(rendered, start, length):
    end = start + 2 * length
    return end <= rendered.frames and all(
        channel[start : start + length] == channel[start + length : end]
        for channel in (rendered.left, rendered.right)
    )


def export_sequence(context, sound):
    engine = context.engine
    engine.reset()
    engine.start_sequence(sound)
    rendered = engine.render(max_frames=CUE_SECONDS * OUTPUT_RATE // FRAME)
    notes, extra = [], {"noteWaves": dict(engine.note_waves)}
    if rendered.randomized:
        low, high = rendered.randomized[0]
        bend = {"min": low, "max": high, "bendRange": 2, "semitones": [low / 64, high / 64]}
        extra["randomPitchBend"] = bend
        notes.append(
            f"the menu draws the pitch bend from [{low}, {high}] on every play; rendered at the middle"
        )
    if not rendered.still_playing:
        return Exported(trim(rendered), OUTPUT_RATE, 1.0, "ax-model", notes=notes, extra=extra)
    unit = repeating_unit(engine, rendered)
    if unit is None:
        notes.append(f"never ends in the menu; the first {CUE_SECONDS} seconds are exported without a loop")
        return Exported(trim(rendered), OUTPUT_RATE, 1.0, "ax-model", notes=notes, extra=extra)
    start, length = unit
    notes.append("never ends in the menu; the loop is one exact repeat of the rendered audio")
    channels = trim(rendered, start + length)
    return Exported(channels, OUTPUT_RATE, 1.0, "ax-model", (start, start + length), notes, extra)


def export_music(context, sound):
    """Render the intro and two passes through the loop, so the second pass is the steady state."""
    engine = context.engine
    engine.reset()
    player = engine.start_sequence(sound)

    def second_pass_done(_):
        events = [event for event in player.loop_events if event[0] == 0]
        return bool(events) and player.tick > 2 * events[0][2] - events[0][1]

    rendered = engine.render(max_frames=OUTPUT_RATE * 400 // FRAME, stop_when=second_pass_done)
    _, first_tick, end_tick = next(event for event in rendered.loop_events if event[0] == 0)
    loop_start = rendered.tick_frames[end_tick] * FRAME
    loop_end = rendered.tick_frames[2 * end_tick - first_tick] * FRAME
    notes = [
        f"intro to tick {first_tick}, then the loop (ticks {first_tick} to {end_tick}) rendered twice; "
        "the second pass is the steady state and is the part that repeats",
        "the two passes differ by a frame or two in where ticks fall, "
        "because 22420.2 frames do not divide evenly",
    ]
    extra = {"loopTicks": [first_tick, end_tick], "noteWaves": dict(engine.note_waves)}
    channels = trim(rendered, loop_end)
    return Exported(channels, OUTPUT_RATE, 1.0, "ax-model", (loop_start, loop_end), notes, extra)


def export_one(context, sound):
    if sound.kind == "wave":
        return export_wave(context, sound)
    if sound.symbol == MUSIC:
        return export_music(context, sound)
    return export_sequence(context, sound)


# --- manifest ---------------------------------------------------------------------


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def describe(context, sound, exported, path, owner):
    archive = context.archive
    frames = len(exported.channels[0])
    rate = exported.sample_rate
    entry = {
        "id": sound.index,
        "kind": sound.kind,
        "file": path.name,
        "sha256": sha256(path),
        "sampleRate": rate,
        "channels": len(exported.channels),
        "frames": frames,
        "duration": frames / rate,
        "loop": exported.loop is not None,
        "volume": sound.volume,
        "gain": exported.gain,
        "priority": sound.priority,
        "player": sound.player,
        "playerMaxSounds": archive.player_limits[archive.players.index(sound.player)],
        "rendering": exported.rendering,
    }
    if sound.kind == "sequence":
        entry["label"] = context.engine.sequence_file(sound).label_for_start(sound.start)
        entry["bank"] = archive.banks[sound.bank_id][0]
    if exported.loop is not None:
        start, end = exported.loop
        entry.update(loopStart=start / rate, loopEnd=end / rate, loopStartFrame=start, loopEndFrame=end)
    if owner != sound.symbol:
        entry["sameAs"] = owner
    entry.update(exported.extra)
    if sound.symbol in USES:
        entry["uses"] = USES[sound.symbol]
    if exported.notes:
        entry["notes"] = exported.notes
    return entry


def renderer_summary(dsp_coef_sha):
    summary = {
        "sequencing": "nw4r SeqPlayer tick clock, MML parser, envelope and channel math, "
        "as in the 4.3 decompilation",
        "voices": "AX voice: 16.16 sample-rate conversion, 96-sample volume ramps, integer mixing",
        "effect": "AXFX ReverbHi on auxiliary A (fused mode 0, 2.5 s, coloration 0.5, as "
        "System::initFx sets it), returned two frames after the send",
        "stereoWaves": "each channel of a stereo wave plays on its own side at unity "
        "(CalcAXPBMIX), not centered",
        "converter": "linear"
        if dsp_coef_sha is None
        else "4-tap filter banks from a DSP coefficient ROM dump",
        "approximations": [
            "reverb arithmetic is double precision where the console uses single precision",
            "randomized pitch bend is rendered at its middle value",
            "surround pan is ignored; the page is stereo",
        ],
    }
    if dsp_coef_sha:
        summary["dspCoefSha256"] = dsp_coef_sha
    return summary


# --- command line -----------------------------------------------------------------


def parse_arguments():
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--archive", type=Path, default=DEFAULT_ARCHIVE)
    parser.add_argument(
        "--executable", type=Path, default=DEFAULT_EXECUTABLE, help="the 4.3U System Menu (audio tables)"
    )
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument(
        "--dsp-coef", type=Path, help="Dolphin's dsp_coef.bin, for the 4-tap sample-rate filter"
    )
    parser.add_argument(
        "--linear-converter", action="store_true", help="interpolate linearly, not with the 4-tap filter"
    )
    parser.add_argument("--only", nargs="+", metavar="SYMBOL", help="export just these sounds")
    parser.add_argument(
        "--skip-music", action="store_true", help=f"skip {MUSIC}, which takes a couple of minutes"
    )
    return parser.parse_args()


def main():
    args = parse_arguments()
    archive = Archive(args.archive.read_bytes())
    unknown = set(args.only or []) - set(archive.sounds_by_symbol)
    if unknown:
        sys.exit(f"unknown sounds: {', '.join(sorted(unknown))}")
    coef_path = None if args.linear_converter else find_dsp_coef(args.dsp_coef)
    if coef_path is None and not args.linear_converter:
        sys.exit("no dsp_coef.bin found: pass --dsp-coef, or --linear-converter for a rougher render")
    tables = load_native_tables(args.executable)
    banks = load_converter_banks(coef_path) if coef_path else None
    context = Context(archive, tables, SoundEngine(archive, tables, banks, linear=coef_path is None))

    args.output.mkdir(parents=True, exist_ok=True)
    sounds, twins = {}, {}
    for sound in archive.sounds:
        if (args.only and sound.symbol not in args.only) or (args.skip_music and sound.symbol == MUSIC):
            continue
        started = time.time()
        twin_key = (sound.file_id, sound.start, sound.bank_id, sound.track_mask, sound.volume)
        path = args.output / f"{sound.symbol}.flac"
        if sound.kind != "wave" and twin_key in twins:
            exported, owner = twins[twin_key]
            shutil.copyfile(args.output / f"{owner}.flac", path)
        else:
            try:
                exported = export_one(context, sound)
            except (Unsupported, UnsupportedSequence) as problem:
                print(f"skipped {sound.symbol}: {problem}", file=sys.stderr)
                continue
            write_flac(path, exported.channels, exported.sample_rate)
            owner = sound.symbol
            twins[twin_key] = (exported, owner)
        sounds[sound.symbol] = describe(context, sound, exported, path, owner)
        print(
            f"{sound.symbol:30s} {sound.kind:8s} {sounds[sound.symbol]['duration']:7.3f} s"
            f"  {path.stat().st_size // 1024:6d} KB  [{time.time() - started:.1f}s]"
        )

    manifest = {
        "schema": SCHEMA,
        "archive": {"file": args.archive.name, "sha256": sha256(args.archive)},
        "executable": {
            "file": args.executable.name,
            "sha256": sha256(args.executable),
            "usedFor": "audio lookup tables",
        },
        "renderer": renderer_summary(coef_path and sha256(coef_path)),
        "players": {
            name: {"maxSounds": limit} for name, limit in zip(archive.players, archive.player_limits)
        },
        "sounds": sounds,
    }
    (args.output / "sounds.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"wrote {len(sounds)} sounds and sounds.json to {args.output}")


if __name__ == "__main__":
    main()
