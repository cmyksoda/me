"""Reader for the Wii System Menu sound archive (IplSound.brsar, RSAR 1.1).

The archive packs RWSD wave-sound sets, RBNK instrument banks and RSEQ
sequences into groups. Everything is big-endian.
"""

from __future__ import annotations

import struct
from array import array
from dataclasses import dataclass

from dsp_adpcm import AdpcmContext, decode_first_pass, decode_loop_pass, nibble_to_sample

CODEC_PCM8, CODEC_PCM16, CODEC_ADPCM = 0, 1, 2

# Reference data types inside the archive's offset tables.
REF_DIRECT, REF_RANGE_TABLE, REF_INDEX_TABLE = 1, 2, 3

SOUND_SEQUENCE, SOUND_STREAM, SOUND_WAVE = 1, 2, 3
SOUND_KIND_NAMES = {SOUND_SEQUENCE: "sequence", SOUND_STREAM: "stream", SOUND_WAVE: "wave"}


class Memory:
    """Big-endian accessors over one bytes object."""

    def __init__(self, data: bytes):
        self.data = data

    def u8(self, offset):
        return self.data[offset]

    def u16(self, offset):
        return struct.unpack_from(">H", self.data, offset)[0]

    def u32(self, offset):
        return struct.unpack_from(">I", self.data, offset)[0]

    def s16(self, offset):
        return struct.unpack_from(">h", self.data, offset)[0]

    def f32(self, offset):
        return struct.unpack_from(">f", self.data, offset)[0]

    def u24(self, offset):
        return int.from_bytes(self.data[offset : offset + 3], "big")

    def cstring(self, offset):
        return self.data[offset:].split(b"\0", 1)[0].decode("ascii")

    def ref_kind(self, offset):
        """Data-type byte of an 8-byte reference (type, kind, pad, offset)."""
        return self.data[offset + 1]

    def ref(self, offset, base):
        return base + self.u32(offset + 4)

    def ref_list(self, offset, base):
        """A counted list of references, each resolved against `base`."""
        return [self.ref(offset + 4 + 8 * i, base) for i in range(self.u32(offset))]


@dataclass(frozen=True)
class Sound:
    index: int
    symbol: str
    file_id: int
    player: str
    volume: int
    priority: int
    kind: str
    start: int  # label offset in the RSEQ, or the sound's index in the RWSD
    bank_id: int | None
    track_mask: int
    channel_priority: int


@dataclass(frozen=True)
class FileLocation:
    file_id: int
    group: str
    header: int  # archive offset of the RWSD/RBNK/RSEQ header
    wave_data: int  # archive offset of the file's sample data
    size: int


@dataclass
class Wave:
    """One wave as the accelerator plays it: a first pass, then the loop section if it loops."""

    sample_rate: int
    codec: int
    loop: bool
    loop_start: int  # sample where playback resumes after the end
    pcm: list  # per channel: samples 0 through the end address
    loop_pcm: list  # per channel: the loop section as a replay decodes it, empty without a loop
    adpcm: list  # AdpcmContext per channel, empty for PCM codecs

    @property
    def frames(self):
        return len(self.pcm[0])


@dataclass(frozen=True)
class Region:
    """One instrument region of a bank (the archive's InstParam record)."""

    offset: int
    wave_index: int
    attack: int
    decay: int
    sustain: int
    release: int
    hold: int
    note_off_type: int
    alternate_assign: int
    root_key: int
    volume: int
    pan: int
    surround_pan: int
    tune: float


@dataclass(frozen=True)
class WaveSoundNote:
    wave_index: int
    attack: int
    decay: int
    sustain: int
    release: int
    hold: int
    root_key: int
    volume: int
    pan: int
    surround_pan: int
    tune: float


@dataclass(frozen=True)
class WaveSoundEntry:
    pitch: float
    pan: int
    surround_pan: int
    aux_sends: tuple
    main_send: int
    notes: list
    events: list  # (position, length, note index) of every track event


class Archive(Memory):
    def __init__(self, data: bytes):
        super().__init__(data)
        if data[:8] != b"RSAR\xfe\xff\x01\x01":
            raise ValueError("expected a big-endian RSAR 1.1 archive")
        self.info = self.u32(24) + 8
        self.names = self._read_names()
        players = self._info_table(16)
        self.players = [self.names[self.u32(entry)] for entry in players]
        self.player_limits = [self.u8(entry + 4) for entry in players]  # sounds a player runs at once
        self.banks = [
            (self.names[self.u32(entry)], self.u32(entry + 4)) for entry in self._info_table(8)
        ]
        self.sounds = [self._read_sound(i, entry) for i, entry in enumerate(self._info_table(0))]
        self.sounds_by_symbol = {sound.symbol: sound for sound in self.sounds}
        self._files = self._info_table(24)
        self._groups = self._info_table(32)
        self._wave_cache = {}

    def _read_names(self):
        symb = self.u32(16) + 8
        table = symb + self.u32(symb)
        return [
            self.cstring(symb + self.u32(table + 4 + 4 * i)) for i in range(self.u32(table))
        ]

    def _info_table(self, slot):
        return self.ref_list(self.ref(self.info + slot, self.info), self.info)

    def _read_sound(self, index, entry):
        kind = self.u8(entry + 22)
        detail = self.ref(entry + 24, self.info)
        if kind == SOUND_SEQUENCE:
            start, bank_id, track_mask = self.u32(detail), self.u32(detail + 4), self.u32(detail + 8)
            channel_priority = self.u8(detail + 12)
        elif kind == SOUND_WAVE:
            start, bank_id, track_mask = self.u32(detail), None, self.u32(detail + 4)
            channel_priority = self.u8(detail + 8)
        else:
            raise ValueError(f"unsupported sound type {kind} for {self.names[self.u32(entry)]}")
        return Sound(
            index=index,
            symbol=self.names[self.u32(entry)],
            file_id=self.u32(entry + 4),
            player=self.players[self.u32(entry + 8)],
            volume=self.u8(entry + 20),
            priority=self.u8(entry + 21),
            kind=SOUND_KIND_NAMES[kind],
            start=start,
            bank_id=bank_id,
            track_mask=track_mask,
            channel_priority=channel_priority,
        )

    def locations(self, file_id):
        """Every packed copy of a file (shared files appear in several groups)."""
        file_info = self._files[file_id]
        found = []
        for position in self.ref_list(self.ref(file_info + 20, self.info), self.info):
            group = self._groups[self.u32(position)]
            item = self.ref_list(self.ref(group + 32, self.info), self.info)[self.u32(position + 4)]
            found.append(
                FileLocation(
                    file_id=file_id,
                    group=self.names[self.u32(group)],
                    header=self.u32(group + 16) + self.u32(item + 4),
                    wave_data=self.u32(group + 24) + self.u32(item + 12),
                    size=self.u32(file_info),
                )
            )
        return found

    def location(self, file_id):
        return self.locations(file_id)[0]

    def bank_location(self, bank_id):
        return self.location(self.banks[bank_id][1])

    def read_wave(self, info, wave_data):
        """Decode one RWAV-style wave record; `wave_data` is its file's sample base."""
        key = (info, wave_data)
        if key not in self._wave_cache:
            self._wave_cache[key] = self._decode_wave(info, wave_data)
        return self._wave_cache[key]

    def _decode_wave(self, info, wave_data):
        codec, loop, channels = self.data[info : info + 3]
        rate = self.u24(info + 3)
        loop_address, last_address = self.u32(info + 8), self.u32(info + 12)
        if codec == CODEC_ADPCM:
            frames = nibble_to_sample(last_address) + 1
            loop_start = nibble_to_sample(loop_address)
        else:
            frames, loop_start = last_address + 1, loop_address
        if channels not in (1, 2) or not 0 < frames < 20_000_000 or not 0 < rate <= 192000:
            raise ValueError("invalid wave metadata")
        looping = bool(loop) and 0 <= loop_start < frames
        channel_table = info + self.u32(info + 16)
        wave = Wave(rate, codec, looping, loop_start, [], [], [])
        for channel in range(channels):
            meta = info + self.u32(channel_table + 4 * channel)
            start = wave_data + self.u32(info + 20) + self.u32(meta)
            if codec == CODEC_ADPCM:
                context = self._adpcm_context(info + self.u32(meta + 4))
                stream = self.data[start : start + (frames + 13) // 14 * 8]
                wave.adpcm.append(context)
                wave.pcm.append(decode_first_pass(stream, frames - 1, context))
                if looping:
                    wave.loop_pcm.append(decode_loop_pass(stream, loop_start, frames - 1, context))
            elif codec == CODEC_PCM16:
                wave.pcm.append(array("h", struct.unpack_from(f">{frames}h", self.data, start)))
            elif codec == CODEC_PCM8:
                signed = struct.unpack_from(f">{frames}b", self.data, start)
                wave.pcm.append(array("h", (value * 256 for value in signed)))
            else:
                raise ValueError(f"unsupported wave codec {codec}")
            if looping and codec != CODEC_ADPCM:
                wave.loop_pcm.append(wave.pcm[-1][loop_start:])
        return wave

    def _adpcm_context(self, offset):
        return AdpcmContext(
            coefficients=struct.unpack_from(">16h", self.data, offset),
            pred_scale=self.u16(offset + 34),
            yn1=self.s16(offset + 36),
            yn2=self.s16(offset + 38),
            loop_pred_scale=self.u16(offset + 40),
            loop_yn1=self.s16(offset + 42),
            loop_yn2=self.s16(offset + 44),
        )


class WaveSoundSet:
    """An RWSD file: wave sounds that play samples directly."""

    def __init__(self, archive: Archive, location: FileLocation):
        if archive.data[location.header : location.header + 4] != b"RWSD":
            raise ValueError("expected an RWSD file")
        self.archive = archive
        self.location = location
        header = location.header
        self.data_base = header + archive.u32(header + 16) + 8
        self.wave_block = header + archive.u32(header + 24)

    def entry(self, index) -> WaveSoundEntry:
        a, base = self.archive, self.data_base
        wsd = a.ref_list(base, base)[index]
        info = a.ref(wsd, base)
        notes = [self._read_note(note) for note in a.ref_list(a.ref(wsd + 16, base), base)]
        events = []
        for track in a.ref_list(a.ref(wsd + 8, base), base):
            for event in a.ref_list(a.ref(track, base), base):
                events.append((a.f32(event), a.f32(event + 4), a.u32(event + 8)))
        return WaveSoundEntry(
            pitch=a.f32(info),
            pan=a.u8(info + 4),
            surround_pan=a.u8(info + 5),
            aux_sends=(a.u8(info + 6), a.u8(info + 7), a.u8(info + 8)),
            main_send=a.u8(info + 9),
            notes=notes,
            events=events,
        )

    def _read_note(self, note):
        a = self.archive
        return WaveSoundNote(
            wave_index=a.u32(note),
            attack=a.u8(note + 4),
            decay=a.u8(note + 5),
            sustain=a.u8(note + 6),
            release=a.u8(note + 7),
            hold=a.u8(note + 8),
            root_key=a.u8(note + 12),
            volume=a.u8(note + 13),
            pan=a.u8(note + 14),
            surround_pan=a.u8(note + 15),
            tune=a.f32(note + 16),
        )

    def wave(self, index) -> Wave:
        info = self.wave_block + self.archive.u32(self.wave_block + 12 + 4 * index)
        return self.archive.read_wave(info, self.location.wave_data)


class Bank:
    """An RBNK file: instrument regions that point into the bank's own waves."""

    def __init__(self, archive: Archive, location: FileLocation):
        if archive.data[location.header : location.header + 4] != b"RBNK":
            raise ValueError("expected an RBNK file")
        self.archive = archive
        self.location = location
        header = location.header
        self.data_base = header + archive.u32(header + 16) + 8
        self.wave_base = header + archive.u32(header + 24) + 8

    def region(self, program, key, velocity) -> Region | None:
        """BankFileReader::ReadInstInfo: the region that answers a key and velocity, if any."""
        a, base = self.archive, self.data_base
        if not 0 <= program < a.u32(base):
            return None
        ref = base + 4 + program * 8
        for value in (key, velocity):
            kind, target = a.ref_kind(ref), a.ref(ref, base)
            if kind == REF_DIRECT:
                break
            if kind == REF_RANGE_TABLE:
                count = a.u8(target)
                slot = next((i for i in range(count) if value <= a.u8(target + 1 + i)), None)
                if slot is None:
                    return None
                ref = target + (count + 4) // 4 * 4 + slot * 8
            elif kind == REF_INDEX_TABLE:
                low, high = a.u8(target), a.u8(target + 1)
                if not low <= value <= high:
                    return None
                ref = target + 4 + (value - low) * 8
            else:
                return None
        if a.ref_kind(ref) != REF_DIRECT:
            return None
        return self._read_region(a.ref(ref, base))

    def _read_region(self, offset):
        a = self.archive
        attack, decay, sustain, release, hold, _, note_off, alternate = a.data[offset + 4 : offset + 12]
        return Region(
            offset=offset,
            wave_index=a.u32(offset),
            attack=attack,
            decay=decay,
            sustain=sustain,
            release=release,
            hold=hold,
            note_off_type=note_off,
            alternate_assign=alternate,
            root_key=a.u8(offset + 12),
            volume=a.u8(offset + 13),
            pan=a.u8(offset + 14),
            surround_pan=a.u8(offset + 15),
            tune=a.f32(offset + 16),
        )

    def wave(self, index) -> Wave:
        info = self.archive.ref(self.wave_base + 4 + index * 8, self.wave_base)
        return self.archive.read_wave(info, self.location.wave_data)


class SequenceFile:
    """An RSEQ file: MML data plus the labels naming its entry points."""

    def __init__(self, archive: Archive, location: FileLocation):
        if archive.data[location.header : location.header + 4] != b"RSEQ":
            raise ValueError("expected an RSEQ file")
        self.archive = archive
        header = location.header
        data_block = header + archive.u32(header + 16)
        self.base = data_block + archive.u32(data_block + 8)  # offsets are relative to this
        label_block = header + archive.u32(header + 24)
        self.labels = []
        for i in range(archive.u32(label_block + 8)):
            entry = label_block + 8 + archive.u32(label_block + 12 + 4 * i)
            name = archive.data[entry + 8 : entry + 8 + archive.u32(entry + 4)]
            self.labels.append((archive.u32(entry), name.rstrip(b"\0").decode("ascii")))

    def label_for_start(self, start):
        """Name of the label a sound starts at; a leading 3-byte track-allocation command is skipped."""
        for skipped in (0, 3):
            for offset, name in self.labels:
                if offset == start - skipped:
                    return name
        return None
