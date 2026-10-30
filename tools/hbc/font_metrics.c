// Prints, as JSON, the Droid Sans metrics that HBC 1.1.3's font.c lays text out with.
// FreeType's v35 interpreter hints like the FreeType HBC was built with: its advances match the fonts' hdmx tables.
// Usage: font_metrics droid.ttf droidbold.ttf U+0020-007E,U+00A0-017F,...

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <ft2build.h>
#include FT_FREETYPE_H
#include FT_DRIVER_H
#include FT_MODULE_H

#define MAX_CODEPOINTS 1024

static FT_Library library;
static long codepoints[MAX_CODEPOINTS];
static int codepoint_count;

static void parse_ranges(char *ranges) {
	for (char *range = strtok(ranges, ","); range; range = strtok(NULL, ",")) {
		char *dash;
		long first = strtol(range + 2, &dash, 16);
		long last = *dash == '-' ? strtol(dash + 1, NULL, 16) : first;

		for (long cp = first; cp <= last && codepoint_count < MAX_CODEPOINTS; ++cp)
			codepoints[codepoint_count++] = cp;
	}
}

static void print_list(const char *key, const int *values) {
	printf("\"%s\":[", key);
	for (int i = 0; i < codepoint_count; ++i)
		printf(i ? ",%d" : "%d", values[i]);
	printf("]");
}

static void print_face(const char *path, const char *name, int em_w, int em_h, int last) {
	static int advance[MAX_CODEPOINTS], left[MAX_CODEPOINTS], width[MAX_CODEPOINTS];
	FT_Face face;
	int em_height = 0;

	if (FT_New_Face(library, path, 0, &face) || FT_Set_Pixel_Sizes(face, em_w, em_h)) {
		fprintf(stderr, "cannot load %s\n", path);
		exit(1);
	}

	for (int i = 0; i < codepoint_count; ++i) {
		FT_GlyphSlot slot = face->glyph;
		FT_UInt index = FT_Get_Char_Index(face, codepoints[i]);

		advance[i] = left[i] = width[i] = 0;
		if (FT_Load_Glyph(face, index, FT_LOAD_DEFAULT) ||
				FT_Render_Glyph(slot, FT_RENDER_MODE_NORMAL))
			continue;

		advance[i] = (slot->advance.x + 32) >> 6;
		left[i] = slot->bitmap_left;
		width[i] = slot->bitmap.rows ? (int) slot->bitmap.width : 0;
		if (codepoints[i] == 'M')
			em_height = slot->bitmap.rows;
	}

	printf("\"%s\":{\"ascender\":%ld,\"descender\":%ld,\"height\":%ld,\"emHeight\":%d,",
			name, (face->size->metrics.ascender + 32) >> 6,
			(face->size->metrics.descender + 32) >> 6,
			(face->size->metrics.height + 32) >> 6, em_height);
	print_list("advance", advance);
	printf(",");
	print_list("left", left);
	printf(",");
	print_list("width", width);
	printf("}%s\n", last ? "" : ",");

	FT_Done_Face(face);
}

int main(int argc, char **argv) {
	FT_UInt v35 = TT_INTERPRETER_VERSION_35;

	if (argc != 4) {
		fprintf(stderr, "usage: %s droid.ttf droidbold.ttf unicode-ranges\n", argv[0]);
		return 1;
	}

	parse_ranges(argv[3]);
	FT_Init_FreeType(&library);
	FT_Property_Set(library, "truetype", "interpreter-version", &v35);

	printf("{\"codepoints\":[");
	for (int i = 0; i < codepoint_count; ++i)
		printf(i ? ",%ld" : "%ld", codepoints[i]);
	printf("],\"faces\":{\n");

	// HBC rasterizes 1.33125 times narrower in 16:9 and stretches the text back out (font.c: font_load).
	print_face(argv[1], "regular-16", 16, 16, 0);
	print_face(argv[1], "regular-16-wide", 12, 16, 0);
	print_face(argv[2], "bold-16", 16, 16, 0);
	print_face(argv[2], "bold-16-wide", 12, 16, 0);
	print_face(argv[2], "bold-20", 20, 20, 0);
	print_face(argv[2], "bold-20-wide", 15, 20, 1);
	printf("}}\n");

	FT_Done_FreeType(library);
	return 0;
}
