# Folding

Folding keeps a place for intermediate content when a chain or split cannot show every full surface. A fold cue is a narrow seam, distinct from a resize divider. Clicking it gives that surface room and folds the nearest neighbours that must yield space. Clicking another cue trades the space again. Every destination stays open, so its draft, scroll position and navigation identity survive. This is a local layout focus, not a modal or browser-history step.

## Vocabulary

| Term | Meaning |
| --- | --- |
| Foldable surface | Any ordinary cell or row unless it declares `fold: false` or `keep: true`. |
| Fold cue | The visible seam of a folded surface. The host can render its contents with `foldContent`. |
| Fold focus | The full cell or row selected by clicking a fold cue. Neighbours fold as needed to make room. |
| Trade | Clicking another cue changes fold focus without closing either surface. |

`keep` and `compact` still describe a persistent rail, such as a mode switcher. A fold cue instead marks full content that can exchange space with the current task. Folding is the default for ordinary cells and rows. Declare `fold: false` on an important surface that must never become a fold cue. Without a declaration, a fold uses a 12px seam; `fold: { size }` overrides that size. A surface excluded from folding may still hide under the normal window rules unless it is also kept.

## One hierarchy at four sizes

The horizontal chain is `Mode → Mailboxes → Messages`. Mode is kept at 48px. Mailboxes needs at least 180px to work; Messages needs at least 270px. The vertical split is `Summary` above `Detail`; Summary needs at least 170px, while Detail needs at least 260px. Both fold to the default 12px seam. Each full cell owns its own scroll; a folded cell keeps its scroll position.

```text
Wide 620px, tall 640px          Mode 48 | Mailboxes 180+ | Messages 270+
                                Summary 170+
                                ─────────────────────────
                                Detail 260+

Narrow 390px, tall 640px        Mode 48 | Mailboxes [12 cue] | Messages 270+
                                Summary 170+
                                ─────────────────────────
                                Detail 260+

Wide 620px, short 350px         Mode 48 | Mailboxes 180+ | Messages 270+
                                Summary [12 cue]
                                ─────────────────────────
                                Detail 260+

Narrow 390px, short 350px       Mode 48 | Mailboxes [12 cue] | Messages 270+
                                Summary [12 cue]
                                ─────────────────────────
                                Detail 260+
```

In the last state, clicking Mailboxes makes `Mode 48 | Mailboxes 180+ | Messages [12 cue]`; clicking Messages exchanges those widths again. Clicking Summary makes `Summary 170+ / Detail [12 cue]`; clicking Detail exchanges the heights again. The host may change the cue's content and colours, or override its 12px layout size per surface.

## Interaction and motion

The default Veil presentation moves the room boundaries and reveals content quietly. During a horizontal trade, both cells stay fitted to their moving rooms while their content keeps its full working width; the moving room clips the content instead of reflowing it. The same room timeline runs in either direction, even when a second click reverses it. A row's content stays anchored to its shrinking or growing surface and fades while the edge moves, so it does not slide over its neighbour or expose the canvas. Origami rotates the folding content toward its edge as those boundaries move; the demo's Paper Fold presentation uses a shallower angle. Folding is a layout transition on the original cell or row, with no detached overlay, backdrop, dimming or undo control. The default cue is a thin line interrupted by three centered diagonal hatch strokes, rotated for the other axis; it contains no chevron. Its stroke follows `--supermax-gutter`, and adjacent folded row and cell seams join at their corners. Its line uses the canvas colour and its fill uses the application surface colour directly in both colour schemes: grey on white in the light demo. No muted surface or colour blend is applied. Hosts can override these defaults with `--supermax-fold-ink` and `--supermax-fold-surface`. `data-direction` names the nearby full surface (`left`, `right`, `up` or `down`) for host styling. The 12px visual seam has a 28px hit target without reserving that width or height. The cue is keyboard operable and has an accessible name that includes the destination title. A navigation action leaves fold focus and returns to ordinary allocation around the new destination.

`ORIGAMI_PRESENTATION` remains an alternative for normal cell transitions. A literal multi-pleat treatment for the fold seam is a separate visual experiment: it should change only the presentation of the same room exchange, and must be checked with large, complex cell content before replacing the calm default.

Choose **Folding: cells and rows** in the [main demo](index.html) to see both axes in the narrow frame. The Motion menu switches the same interaction between Veil, Origami and Paper Fold.

![Horizontal and vertical folds in the main demo](assets/captures/folding.png)

[Horizontal space traded](assets/captures/folding-horizontal.png) · [Vertical space traded](assets/captures/folding-vertical.png)

[Watch the two horizontal trades at normal speed](assets/captures/folding-horizontal-trade.mp4).
