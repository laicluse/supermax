# Changelog

## 2.0.0 (2026-11-20)

Start with [Migrating from v1 to v2](docs/migrating-to-v2.md). A dependency version bump alone does not migrate the host's behavior, and adopting the new Workspace is a separate choice.

### Rendering

- A cell paints the gutters around it. The roots of `cell`, `veil` and `header` now span the cell and its gutters, each gutter as a transparent border, and their state carries `gutter: { size, top, right, bottom, left }`. `raise(on)` puts a cell above the neighbours it shares a gutter with. A custom renderer that fills its root with a background now fills those gutters and the title seam as well; add `background-clip: padding-box` to keep them open. See [Painting the gutters](docs/rendering.md#painting-the-gutters).
- The gutter between two cells of one chain is one `--supermax-gutter` wide. The default surface used to start a second gutter width into the cell.

### Workspace composition

- The newest cell of a split row takes what the row's cells leave after their maxima, unless the user sized that cell or its split, so a title bar and a surface never stop short of the row's edge.
- A destination can declare `growOnFocus: true`. While the new Workspace option `growOnFocus` (or `setGrowOnFocus`) is on and DOM focus is inside such a cell, it grows toward its `preferred` (or toward a width given in place of `true`), and its split row toward its `preferredHeight`, and the cells around it give way for that: down to their minima, then by hiding or folding in the order a narrow window uses, a kept cell staying. It never ends smaller than without growth and closes nothing; everything returns when focus leaves, and opening a fold that only growth made ends the growth. A divider size wins, zoom suspends it, and the change animates through the presentation. Off by default.
- A destination can declare `back: true`. While such a cell and the cell it was opened from both stand in full view, the Show control's button in its leading part, chevron only, steps back: `requestBack(occurrence)` closes the cell and what it opened, and the parent takes the room. A detail that opened by itself beside its collection used to close only when the user chose another item. Where the parent hid or folded, Show and the fold handle remain the route, and a cell that holds Show shows Show. The step back asks through `show` and reports through `up`; its accessible name is the new string `backTo`. A row cannot declare it (`back-on-row`).
- The `show` event carries `retry()`, which repeats the request that asked: Show, a fold handle or a step back. A host that refused to ask about a draft calls it once the user agrees; calling `requestUp()` there repeated only Show.
- A destination can declare `aspectRatio` for content that scales with its width, such as a chart. A split row holding it asks no more height than the content shows at its cell's width, so a narrower window or a cell opened beside it gives that row's height to the elastic row below. The ratio is a second ceiling beside `maxHeight` and never goes below `minHeight`; the layout row reports it as `fitHeight`. `aspectInset` keeps a toolbar or padding that does not scale out of the ratio, and `setAspectRatio` switches both when the content changes form. See [Aspect ratio](README.md#aspect-ratio).
- A server that declares a destination again after `setVariants` or `setAspectRatio` changed it is compared with its own earlier declaration, and new splits in that response are checked against the runtime value. The repeat used to fail with `declaration-mismatch`.

- A following split yields preferred width to a resized column while keeping its row content visible at the declared minimums. A wide list no longer stops at the split’s preferred width.

- A divider defines only its preceding cell or row; earlier allocations stay put and later content shares the remaining room normally. Fixed or stationary gutters no longer resize a different column or enter the active resize state. Reset clears only the size belonging to that gutter.

- Independent splits can follow full-height cells along the root chain, retaining their own row windows and correct path sync and zoom. The guides document `Navigator.startRows()` for the initial task row.
- A workspace sets `supermaxWorkspace` on its host element and removes it when it is destroyed, so a tool that drives the page from outside, such as the plugin's cell sweep, can size cells without the host exporting anything.
- A chain clips its strip instead of hiding its overflow, so it cannot hold a scroll offset. Focus landing in a cell, such as an autofocused field, used to scroll the chain by the width of the cells that had left the window, which pushed the visible cells out of view.
- A split can be the workspace root. It opens with its rows, at construction and after `reset()`; a root split used to stay empty, so nothing could open from its rows.
- A fold handle opens its surface the way Show does. A folded cell takes its room from the trailing end of its chain: cells close from the end until it shows in full beside the cells that showed before, announced through the cancelable `show` and then `up`. A folded row makes the rows after it fold. A fold collapses onto its leading edge and opens toward the trailing side, except after the active surface, where it opens toward the leading side. Adjacent folds share one handle. It opens the fold nearest the active surface, as Show would, together with every fold behind it that the freed room holds, and then names the next fold back that found no room. A drag is the transition Show plays, with the pointer as its clock: every cell moves and leaves as it does for Show. A drag closes nothing until it is released past the threshold. Clicking a handle used to trade room with the nearest neighbours instead, which could fold two cells and reopen a distant one.
- `Navigator.focusFold()` is now `unfold(occurrence, axis)` and returns the cells it closed. Snapshots carry `unfolded` where they carried `foldFocuses`, layout placements no longer carry `foldPage`, and the workspace emits `unfold` where it emitted `foldfocus`.
- Reduced motion stills the Veil presentation's content fade as well. A cell that opened or folded under `prefers-reduced-motion: reduce` still ran a 70 to 160ms opacity transition on its title and body.
- Starting or cancelling a fold drag no longer restyles the content inside the cells it moves. The shell keeps its cell gutter and paper widths from inheriting into content, leaves `inert` alone until the drag settles, and relies on `inert` instead of `pointer-events` for a folded body. With about 52000 elements in a folding cell, the first drag frame dropped from 146 to 89 ms and the cancel from 145 ms to below 50 ms; the rest is the content's own layout and paint.
- A host gets the content of a closing cell back, through `dispose`, before the cell, its row or its chain leaves the document. A row could leave first, which left the host's own element outside the document without notice.
- Variant forms must together admit every size between the smallest and the largest of them; a declaration that leaves a gap is refused with `variant-gap`. A smaller form now declares a `max` up to the next form's threshold. Allocation still gives it what it prefers, and a divider can stop at every size in between, where it used to jump from one form to the other.
- A split the user sized hands that width to its rows. The newest cell of each row takes the width up to where its next form takes over. A split whose row cells showed their smaller form used to stop at their preferred width, so its divider jumped to the larger form.
- A cell whose width changes by less than 2 pixels takes its new width at once. It used to keep its old width until the transition around it settled, so a cell that lost a pixel lay under its neighbour and covered the gutter between them. A cell whose left edge stays put grows at its right edge however little it grows; a cell that grew by 2 pixels used to slide in from under its left neighbour or the edge of the window.
- A cell with responsive variants that folds keeps the form it was last shown in. The allocator picks the preferred form for a cell it does not show, so an icon column that folded while a neighbour opened used to switch to its label form halfway through the fold.

### Breaking changes

- Workspace cells and rows declare at most one `overflow` policy, and `{ mode: "keep" }` is its only choice. A cell or row that gives way below a kept one folds; with nothing kept above it, it leaves the window behind Show. `{ mode: "hide" }` is refused as `invalid-overflow`. A folded surface shows none of its content, and `{ mode: "fold", size }` only gives a host room to draw a fold of its own. A title bar drawn by the host's own `header` part used to stay visible in that room; it is hidden like the default one. Destination placement uses `placement: "beside-split"`; `keep`, `fold` and `height` are rejected on Workspace destinations.
- A split that declares `header: "title"` now reaches the `content` callback and returns only `{ header }`, so controls stand in its bar the way they do in a cell's. A callback that cannot answer for a split must return `{}` for it.
- Paint tokens belong to the built-in renderer under `--supermax-default-*`. A host replaces part factories for its own style; geometry and transition timelines remain shell-owned.

- Layouts report an actual vertical space shortage through `overflow`; the fixed-threshold `belowMinimum` field is removed. `minViewportHeight` remains the validation guarantee for every declared split, even when a particular folded layout fits below it.
- The package no longer assigns `globalThis.Supermax`; use named ESM imports.
- The workspace draws no navigation bar. The Show control lives in the title bar of the cell highest in the hierarchy that hides what it brings back, or at that cell's top left corner; `chrome.navbar`, `strings.navigation` and the `--supermax-navbar` property are gone, and the group's title is the host's to show from `locationInfo`. The Show control spells out what it brings back only for a title of at most 20 characters that differs from its bar's, and says Back (`strings.back`) otherwise. The title bar carries no typography of its own and has three parts, leading for the Show control, the title, and trailing for the content's controls; the application styles it.
- `CellCollection.distribute()` no longer returns `spareColumns`. Compute the remainder from the returned widths, or observe `layout.chains.get(root).spare` when using Workspace.
- Under a budget smaller than the surviving cell's minimum, the allocator preserves that minimum rather than shrinking the cell to fit; a zero budget therefore no longer hides the surviving cell.
- A split declares no `min`, `max` or `preferred` of its own; `register()` and the navigator refuse one that does (`split-with-width`). Its width follows its widest row, so a cell that opens in a row widens the split. The layout declaration schema is 2 (`LAYOUT_SCHEMA`); a server that declares splits drops their widths and sends `v=2`.
- Cell configuration now interprets `keep`, `preferred` and `elastic`. Map domain objects explicitly instead of passing unrelated properties through as layout configuration.
- Compared with the 1.1 strip, hidden interior entries no longer reserve a gap. An animated update from rest has a settling delay; departing entries can remain mounted longer. Await completion instead of assuming fixed elapsed time or immediate removal.
- `VEIL_PRESENTATION` is the Workspace default. Pass `ORIGAMI_PRESENTATION` explicitly for the 3D card-fold treatment.

### Added

- Room above the minimums is given out along a curve of position, so later cells and lower rows get more of it, the way the original Stacks allocator favoured the deepest cell; `DEFAULT_CURVE` is `linearCurve(1)`, the navigator takes a `curve` option and `setCurve()`, and the demo has a steepness slider with the curve drawn beside it.
- A preference decides which cells show, not where they stand. A chain gives way from the left, folding or hiding by each cell's overflow mode, until every cell left can have its `preferred` (or its `min` without one), and settles for the minimums only when the cells that cannot give way ask more than there is; the cells that show then stand on their minimums and share the rest along the curve, so an earlier cell may stand under its preference. Split rows give way at their minimums only. The demo's cells declare their preferences accordingly.

- Host renderers replace visual parts through one mount/update/dispose contract. Native action bindings retain shell semantics; cell material and foreground are separate, and frustum painters follow shell-owned geometry. The built-in renderer uses the same interface and its own paint namespace. Title-bar height comes from navigator chrome. The separate `foldContent`, `noticeIcon` and drawing `origin` options are replaced by renderer parts.


- Responsive cell and row variants give unused space back to neighbouring content. Selection is deterministic across both axes, preserves fold and Show access, and supports content transitions on the shared animation lifecycle.

- Fold handles display available titles in bundled Tiny5 Regular, with a 96px length cap and ellipsis. Missing titles retain hatching. Font copyright and OFL license are included; only the static Regular weight is shipped.

- Surviving cards no longer shift sideways and return during small width reductions, including interrupted transitions.

- Every layout carries an access route for every open cell. Back preserves previously hidden branches; zoom always retains its exit. Fold handles come from the layout, and a drag keeps its initial handles while one gutter follows each moving row boundary.
- Open cells and rows after the active surface retain a fold handle or a scroll route when space runs out. Show continues to reach earlier hidden content. Notices use the canvas hairline and fold-handle corner radius by default.
- Navigator and Workspace provide a branching cell shell, layout declarations, Show, dividers, loading content, overlays, presentations and a shared time scale.
- `navigator.focus()` and the workspace's `focus` event name where the user navigated last, with its path of destination ids and the menu item to mark: the first destination from the root that declares `menu: true`, or `menu: "exact"` while it has the focus itself.
- A cell draws no title bar unless it declares `header: "title"`; the title stays its accessible name. A split may declare it too, one bar above its rows, and a cell inside a row draws its own bar within the row's height.
- A destination may declare `placement: "beside-split"`: opened from a cell in a row it stands beside the split at the full height, the shell's answer to a colspan; one breakout per split, replaced by the next. `navigator.next(occurrence)` names what follows a cell in its chain, `replay` takes a `sync` action, a split in `ifRoom` opens with its rows, and `sync` names a path into a row: after a split the next id is one of its rows.
- `VEIL_PRESENTATION` opens, closes and replaces cells by lifting and lowering a veil in the cell's own surface colour, without rotating or travelling, for workspaces with large cells. Presentation poses may carry `duration`, `easing` and `delay`, and a motion may set `follow: false` and `travel(pixels)`.
- A cell or split row can declare `fold: { size }`. When space is scarce it keeps a clickable seam; clicking it unfolds that surface and folds neighbours as needed, so horizontal cells and vertical rows can trade space without closing. `foldContent` and fold colour variables customize the cue.

### Retained

- `CellCollection`, `CellProxy` and `CellStrip` remain exported for hosts that retain their existing renderer, subject to the compatibility changes above.

2.0.0 is the `master` branch on GitHub. It is not on the npm registry; install it from a git reference as the README describes.
