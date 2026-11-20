# Smaller pixel fonts for fold handles

Status: exploration, 2026-10-27. The requested refinement is one extra CSS pixel of visible whitespace on every side while keeping the existing 14 px short dimension. That leaves exactly 6 px for visible letters, compared with the previous [8 px ink study](fold-label-typography.md).

See the [comparison capture](fold-label-microfonts.png), [browser specimen](fold-label-microfonts.html), and [counted Tiny5 pixel enlargement](fold-label-tiny5-pixels.png). These are static typography proposals. The library's hatching and navigation remain unchanged.

The [Tiny5 actual-size PNG](fold-label-tiny5-actual-size.png) shows both orientations without enlargement or a pixel grid. Run `node docs/research/fold-label-tiny5-actual-size.mjs` to refresh it: 420 × 320 logical pixels captured at 2×, stored as 840 × 640 pixels with 144 dpi metadata so its intended display size is retained.

The [Tiny5 weight comparison](fold-label-tiny5-weights.png) shows all nine real variable-font weights from Thin 100 through Black 900 side by side at the same 8 px font size and 14 px handle thickness. Run `node docs/research/fold-label-tiny5-weights.mjs` to regenerate it from the original variable outlines, without synthesizing bold or quantizing away weight differences. The heavier outlines naturally occupy slightly more ink height; font size stays fixed. The PNG includes 144 dpi metadata for its 2× capture.

| Typeface | Visible uppercase height | Inset to outer edge, including outline | DOCUMENTS handle length | License |
| --- | --- | --- | --- | --- |
| Spleen 5×8 | 6 px | 4 px | 52 px | BSD-2-Clause |
| Tom Thumb | 5 px | 4.5 px | 44 px | CC0 option permitted by the original author |
| Micro 5 | 5 px | 4.5 px | 45 px | SIL OFL 1.1 |
| Tiny5, original pixel size | 5 px | 4.5 px | 53 px | SIL OFL 1.1 |

Spleen is the recommended next trial for the exact spacing requirement: 4 + 6 + 4 = 14, with whole CSS pixels in both orientations. Tom Thumb is the narrowest miniature alternative. Micro 5 has more of a game-like character. Tiny5 is included at its original five-row size rather than enlarged to the previous study's eight-row cap height. None of these samples stretch a five-row glyph into six rows.

Five-row capitals cannot have equal integer CSS-pixel margins inside an even 14 px handle: (14 − 5) ÷ 2 = 4.5. On a 2× display those outer insets are exactly 9 device pixels. The outline occupies 1 CSS px of each inset, so the clear white gap between Tiny5 and the inside of its outline is 3.5 CSS px, or 7 device pixels. Spleen's clear white gap is 3 CSS px. On 1×, whole-pixel placement and perfect symmetry cannot both be maintained for five-row letters; Spleen avoids that particular conflict. Fractional display scaling and zoom still require visual checks.

The specimens use the original BDF pixels for Spleen and Tom Thumb. Tiny5 and Micro 5 outlines are sampled into a one-bit grid at their design size, then drawn as unit SVG squares. Each specimen's outline and glyphs now share one SVG coordinate system, preventing independent CSS shadow and SVG placement rounding at half-pixel positions or under scaling. This is a comparison technique, not a chosen production renderer. Labels missing glyphs or exceeding six rows including accents fall back to the existing hatch. No accent is silently removed, substituted or squeezed. Complete titles remain accessible names and tooltips. Canvas ink and surface colour are unchanged, so text contrast remains open.

Run `python3 docs/research/build-microfont-glyphs.py` to regenerate the specimen repertoire from the original font files, then `node docs/research/fold-label-microfonts.mjs` to verify and refresh the capture. The [measurements](fold-label-fonts/micro-measurements.json) cover all four fonts in both orientations at DPR 1, 1.5 and 2: 14 px thickness, equal optical margins, integer glyph coordinates, and fallback for unsupported accented labels. These checks establish geometry and glyph construction, not live fold behaviour or universal readability.

Run `node docs/research/fold-label-tiny5-pixels.mjs` for the separate painted-pixel regression and enlargement. It replays the earlier specimen from [laicluse/supermax@b5bbee8](https://github.com/laicluse/supermax/commit/b5bbee8), captures the current specimen, and measures the actual outline and glyph pixel bounds rather than their DOM boxes. A diagnostic colour separation distinguishes the outline from letters without changing geometry; the displayed enlargement uses the original grey captures with nearest-neighbour enlargement. The [pixel measurements](fold-label-fonts/tiny5-pixel-measurements.json) reproduce earlier normal-scale gaps of 8/6/6/8 device pixels and 2× detail gaps of 16/12/16/12. The corrected 2× display capture has 7/7/7/7 normally and 14/14/14/14 in the enlarged details, on both axes. Order: left/right/top/bottom. The previous DOM-box check passed despite that visible defect; it is not treated as proof of painted symmetry.

Original sources: [Spleen](https://github.com/fcambus/spleen), [Tom Thumb and its author's license declaration](https://robey.lag.net/2010/01/23/tiny-monospace-font.html), [Micro 5](https://github.com/google/fonts/tree/main/ofl/micro5), and [Tiny5](https://github.com/google/fonts/tree/main/ofl/tiny5). The [source register](fold-label-fonts/sources.json) records download URLs and SHA-256 hashes. Source font files, copyright notices and licenses remain alongside the generated glyph data. OpenType describes a font format; the licenses above establish reuse permission.
