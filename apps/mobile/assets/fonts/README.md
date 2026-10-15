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

`MaterialIcons-Ordo.ttf` is a subset of Material Icons (Apache 2.0, via
@expo/vector-icons) holding only the icons the app references. Regenerate it
with `node --experimental-strip-types scripts/build-icon-font.mjs`.
