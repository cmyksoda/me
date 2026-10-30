#!/bin/sh
# Rebuilds src/hbc's Droid Sans subsets and text metrics from HBC 1.1.3's own font files.
# Usage: tools/hbc/fonts.sh <clone of fail0verflow/hbc> [ref, default upstream/master]
# Needs git, a C compiler, FreeType's headers and fontTools with brotli (pyftsubset).
set -eu

hbc=$1
ref=${2:-upstream/master}
out=$(cd "$(dirname "$0")/../.." && pwd)/src/hbc
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# Latin-1, Latin Extended-A and the punctuation app descriptions tend to use.
ranges=U+0020-007E,U+00A0-017F,U+2013-2014,U+2018-2019,U+201C-201D,U+2022,U+2026,U+20AC,U+2122

for font in droid droidbold; do
	git -C "$hbc" show "$ref:channel/channelapp/data/$font.ttf" > "$work/$font.ttf"
	pyftsubset "$work/$font.ttf" --unicodes="$ranges" --layout-features= \
		--flavor=woff2 --output-file="$out/assets/$font.woff2"
done

cc -O2 -o "$work/font_metrics" "$(dirname "$0")/font_metrics.c" $(pkg-config --cflags --libs freetype2)
"$work/font_metrics" "$work/droid.ttf" "$work/droidbold.ttf" "$ranges" > "$out/metrics.json"
