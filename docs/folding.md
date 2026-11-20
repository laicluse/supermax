# Folding

Folding keeps a place for intermediate content when a chain or split cannot show every full surface. A fold cue is a narrow seam, distinct from a resize divider. Clicking it gives that surface room and folds the nearest neighbours that must yield space. Clicking another cue trades the space again. Every destination stays open, so its draft, scroll position and navigation identity survive. This is a local layout focus, not a modal or browser-history step.

The up/back (Show) control also reaches earlier folded cells and rows, so the seam is not their only entry point. Unlike a fold click, Show navigates backward: it closes trailing cells as needed or moves the row window upward. Further clicks continue to earlier context, never toggling back to a fold on the right or below. Rows remain part of their split. The existing cancelable `show` event lists any cells that would close, and `up` reports those actually closed.

## Vocabulary

| Term | Meaning |
| --- | --- |
| Foldable surface | Any ordinary cell or row unless it declares `fold: false` or `keep: true`. |
| Fold cue | The visible seam of a folded surface. The host can render its contents with `foldContent`. |
| Fold focus | The full cell or row selected by clicking a fold cue. Neighbours fold as needed to make room. |
| Trade | Clicking another cue changes fold focus without closing either surface. |

`keep` and `compact` still describe a persistent rail, such as a mode switcher. A fold cue instead marks full content that can exchange space with the current task. Folding is the default for ordinary cells and rows. Declare `fold: false` on an important surface that must never become a fold cue. Without a declaration, a fold reserves no space; `fold: { size }` optionally reserves a non-negative width or height. A surface excluded from folding may still hide under the normal window rules unless it is also kept.

## One hierarchy at four sizes

The horizontal chain is `Mode → Mailboxes → Messages`. Mode is kept at 48px. Mailboxes needs at least 180px to work; Messages needs at least 270px. The vertical split is `Summary` above `Detail`; Summary needs at least 170px, while Detail needs at least 260px. Both fold without reserving space. Each full cell owns its own scroll; a folded cell keeps its scroll position.

```text
Wide 620px, tall 640px          Mode 48 | Mailboxes 180+ | Messages 270+
                                Summary 170+
                                ─────────────────────────
                                Detail 260+

Narrow 390px, tall 640px        Mode 48 | Mailboxes [handle] | Messages 270+
                                Summary 170+
                                ─────────────────────────
                                Detail 260+

Wide 620px, short 350px         Mode 48 | Mailboxes 180+ | Messages 270+
                                Summary [handle]
                                ─────────────────────────
                                Detail 260+

Narrow 390px, short 350px       Mode 48 | Mailboxes [handle] | Messages 270+
                                Summary [handle]
                                ─────────────────────────
                                Detail 260+
```

In the last state, clicking Mailboxes makes `Mode 48 | Mailboxes 180+ | Messages [handle]`; clicking Messages exchanges those widths again. Clicking Summary makes `Summary 170+ / Detail [handle]`; clicking Detail exchanges the heights again. The host may change the cue's content and colours, or reserve space per surface with `fold: { size }`.

## Interaction and motion

The default Veil presentation moves the room boundaries and reveals content quietly. During a horizontal trade, both cells stay fitted to their moving rooms while their content keeps its full working width; the moving room clips the content instead of reflowing it. The same room timeline runs in either direction, even when a second click reverses it. A row's content stays anchored to its shrinking or growing surface and fades while the edge moves, so it does not slide over its neighbour or expose the canvas. Origami rotates the folding content toward its edge as those boundaries move; the demo's Paper Fold presentation uses a shallower angle. Folding is a layout transition on the original cell or row, with no detached overlay, backdrop, dimming or undo control. The default cue is a thin gutter with an attached handle containing three diagonal hatch strokes, rotated for the other axis; it contains no chevron. Its line sits on the adjacent cell or row gutter and follows `--supermax-gutter` in thickness. The handle lies entirely on the unfolding side of that line. Its straight side meets the gutter; only the two outward corners are rounded. It has a surface-coloured fill, padding and a 1px canvas-coloured outline. The same attachment applies between cells and at viewport edges, where the gutter remains visible. `--supermax-fold-padding` (3px) and `--supermax-fold-radius` (2px) customize the marker shape. Its line uses the canvas colour and its fill uses the application surface colour directly in both colour schemes: grey on white in the light demo. No muted surface or colour blend is applied. These two colour roles follow `--supermax-canvas` and `--supermax-surface` directly, including on hover. `data-direction` names the nearby full surface (`left`, `right`, `up` or `down`) for host styling. Only the hatch handle opens the fold; the bare gutter is not clickable. The layout reservation defaults to 0px. The cue is keyboard operable and has an accessible name that includes the destination title. A navigation action leaves fold focus and returns to ordinary allocation around the new destination.

`ORIGAMI_PRESENTATION` remains an alternative for normal cell transitions. A literal multi-pleat treatment for the fold seam is a separate visual experiment: it should change only the presentation of the same room exchange, and must be checked with large, complex cell content before replacing the calm default.

Choose **Folding: cells and rows** in the [main demo](index.html) to see both axes in the narrow frame. The Motion menu switches the same interaction between Veil, Origami and Paper Fold.

![Horizontal and vertical folds in the main demo](assets/captures/folding.png)

[Horizontal space traded](assets/captures/folding-horizontal.png) · [Vertical space traded](assets/captures/folding-vertical.png)

[Watch the two horizontal trades at normal speed](assets/captures/folding-horizontal-trade.mp4).

[Watch up/back continue toward earlier content](assets/captures/folding-up.mp4) · [After the first back step](assets/captures/folding-up.png).

Canvas-coloured hatching on the white host background at the viewport edge: [right edge](assets/captures/folding-edge-right.png) and [bottom edge](assets/captures/folding-edge-bottom.png). The two outer corners are square against the edge; only the two inner corners are rounded.

The host controls gutter thickness with `--supermax-gutter` (1px by default, including at a folded viewport edge). Set it to `0px` for a gutterless host; the handle retains its 1px outline and hatch strokes. Fold reservation is independent: `fold: { size: 8 }` reserves 8px horizontally on a cell or vertically on a row. The main demo offers **Folding: 8px reserved on both axes** alongside the default unreserved scenario.

[8px reservation on both axes](assets/captures/folding-reserved.png) · [Host with 0px gutters](assets/captures/folding-gutterless.png).
