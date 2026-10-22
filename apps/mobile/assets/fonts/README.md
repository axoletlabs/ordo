# Reading fonts

The article reader ships reading typefaces from
[nicoverbruggen/ebook-fonts](https://github.com/nicoverbruggen/ebook-fonts)
(standardized builds for e-reading, v2026.08.05):

| Reader option | Typeface | Origin |
| --- | --- | --- |
| Libron *(default serif)* | Libron | Nico Verbruggen's reading refinement of Newsreader (Production Type) |
| Legible Sans *(sans)* | NV Legible Next | Nico's build of Atkinson Hyperlegible Next (Braille Institute) |
| Garamond | NV Garamond | EB Garamond revival (Octavio Pardo / Georg Duffner), optically enlarged |
| Bitter | NV Bitter | Bitter (Sol Matas), contemporary slab serif |
| Jost | NV Jost | Jost (Owen Earl), Futura-like geometric sans |

License files (`LICENSE-*.txt`) name the original authors as the SIL Open
Font License 1.1 requires. Font files are renamed (Expo font keys) and
subset with fontTools to drop glyphs only reachable through OpenType
features the app never enables (swashes, stylistic sets, historic ligatures)
plus PostScript glyph names. Every character, its outline and advance, and
kerning/ligatures are unchanged; Garamond shrinks by about a quarter:

```
pyftsubset IN.ttf --unicodes='*' --no-glyph-names --notdef-outline \
  --layout-features='ccmp,locl,mark,mkmk,kern,liga,clig,calt,rlig,rvrn,curs,dist,abvm,blwm,lnum,onum,tnum,pnum,smcp' \
  --name-IDs='*' --name-languages='*' --name-legacy --legacy-kern --output-file=OUT.ttf
```

## Preview subsets

The settings typeface labels use five tiny ASCII-only files:

| File | Registered family |
| --- | --- |
| `Libron-Preview.ttf` | `Libron_400Regular_Preview` |
| `NVLegibleNext-Preview.ttf` | `NVLegibleNext_400Regular_Preview` |
| `NVGaramond-Preview.ttf` | `NVGaramond_400Regular_Preview` |
| `NVBitter-Preview.ttf` | `NVBitter_400Regular_Preview` |
| `NVJost-Preview.ttf` | `NVJost_400Regular_Preview` |

They are built from the same regular faces, carry the same
copyright/license name records, and are covered by the same `LICENSE-*.txt`
files as their full faces. The distinct family names are deliberate: a
preview arriving must never mark the article's full family ready or shadow its
full glyph coverage. The article keeps using the full
`*-Regular/Bold/Italic` faces.

Regenerate one with:

```
python3 -m fontTools.subset NVGaramond-Regular.ttf \
  --output-file=NVGaramond-Preview.ttf \
  --unicodes='U+0020-007E' --no-glyph-names --notdef-outline \
  --layout-features='kern' --legacy-kern \
  --name-IDs='*' --name-languages='*' --name-legacy
```

Then rename the internal family in name IDs 1, 4 and 16 to the registered
family above, name ID 6 to the same string without underscores (for example
`NVGaramond400RegularPreview`), and keep name ID 17 as `Regular`. The Expo
loader registers by the JS key, but matching the internal name avoids platform
font-manager ambiguity. Verify each subset still contains every character in
its label (`Libron`, `Legible Sans`, `Garamond`, `Bitter`, `Jost`) and that its
advance widths match the full face.

`MaterialIcons-Ordo.ttf` is a subset of Material Icons (Apache 2.0, via
@expo/vector-icons) holding only the icons the app references. Regenerate it
with `node --experimental-strip-types scripts/build-icon-font.mjs`.
