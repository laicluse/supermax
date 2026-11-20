# Fold labels: compact retro typography

The current [smaller pixel-font study](fold-label-microfonts.md) explores a further pixel of whitespace on every side. This page retains the earlier 8 px ink comparison.

Status: exploration, 2026-10-27. The accepted [hatching handle](folding-seam-alternatives.md) remains unchanged. This study asks whether a folded surface's name can replace the hatch without increasing thickness, with equal whitespace measured from the visible letters.

Open the [browser specimen](fold-label-typography.html) or [comparison capture](fold-label-typography.png). The panels are static typography and geometry samples, not evidence of working fold navigation. All content is generic.

All three variants have exactly 14 CSS px of visible thickness. The visible letters occupy 8 px on the short axis, leaving exactly 3 px on every side of their tight ink bounds. Font sidebearings and invisible ascent/descent space are removed rather than added to CSS padding. Only length grows. Whole words read left to right horizontally and bottom to top vertically. Surface fill, canvas ink, inset outline and attached corners follow the existing handle.

| Typeface | Source font size | DOCUMENTS ink height | Handle length at DPR 2 | Trade-off |
| --- | --- | --- | --- | --- |
| Tiny5 | approximately 12.8 px | 8 px | 73 px | Chunkier pixel lettering at the shared ink height |
| Departure Mono | approximately 11 px | 8 px | 64.5 px | Blocky monospaced computer lettering |
| Bebas Neue | approximately 11.11 px | 8 px | 42 px | Compact outline; less pixel-like |

Departure Mono is the proposed next direction, not an accepted choice. Tiny5 is the chunkier pixel alternative; Bebas Neue provides a distinct condensed outline comparison. Silkscreen and Pixelify Sans were initially measured but omitted from the final sheet because the pixel treatments were too similar.

The 96 px ink-length cap and ellipsis are specimen settings, not library defaults. Full titles remain accessible names and tooltips. Accents are preserved and count towards the visible bounds. The specimen renders each word with its local font, scans nontransparent pixels, tightly crops that raster and fits it to exactly 8 CSS px of ink height. A CSS mask applies the existing canvas colour. This is an exploration of optical spacing, not a proposed production rendering strategy. Normalizing glyph height can compromise a pixel font's native grid; the samples show their source size. A production policy for unsupported scripts is unresolved.

Run `node docs/research/fold-label-typography.mjs` from the repository root to refresh the capture and [measurements](fold-label-fonts/measurements.json). Chromium checks both orientations at DPR 1, 1.5 and 2: the normal-scale shortest dimension is exactly 14 CSS px, computed padding exactly 3 px, visible ink exactly 8 px, and all four margins from the tightly cropped ink to the outer handle exactly 3 px (within 0.02 px layout precision). The crop is checked for outer transparent space. This validates geometry, not readability or crispness at fractional DPR. At fractional scaling, 3 CSS px need not equal an integer number of device pixels; the specification is in CSS px, with 6 device pixels per margin on a 2× display. Explicitly enlarged 2× details are excluded from normal-scale assertions.

The [sources and hashes](fold-label-fonts/sources.json) pin unmodified files with their original OFL licenses alongside them. The [cmap check](fold-label-fonts/glyph-coverage.json) confirms uppercase letters, selected accented characters, middle dot and ellipsis exist in all three files. [Departure Mono](https://github.com/rektdeckard/departure-mono) recommends font sizes in multiples of 11 px. [Tiny5](https://github.com/google/fonts/tree/main/ofl/tiny5) and [Bebas Neue](https://github.com/google/fonts/tree/main/ofl/bebasneue) come from Google Fonts.

Before adoption, test live folds, title changes, seam collisions, short rows, viewport edges, browser/text zoom, fractional display scaling and touch/keyboard dragging. Preserve native recovery and the invisible touch target. Existing canvas ink has deliberately not been redesigned; text contrast remains open before rollout. Nondefault gutter and padding values also need verification. No library defaults change in this study.
