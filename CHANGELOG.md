# Changelog

## 2.0.0 (unreleased)

Start with [Migrating from v1 to v2](docs/migrating-to-v2.md). A dependency version bump alone does not migrate the host's behavior, and adopting the new Workspace is a separate choice.

### Breaking changes

- The package no longer assigns `globalThis.Supermax`; use named ESM imports.
- The workspace draws no navigation bar. The Show control lives in the title bar of the cell highest in the hierarchy that hides what it brings back, or at that cell's top left corner; `chrome.navbar`, `strings.navigation` and the `--supermax-navbar` property are gone, and the group's title is the host's to show from `locationInfo`. The Show control spells out what it brings back only for a title of at most 20 characters that differs from its bar's, and says Back (`strings.back`) otherwise. The title bar carries no typography of its own and has three parts, leading for the Show control, the title, and trailing for the content's controls; the application styles it.
- `CellCollection.distribute()` no longer returns `spareColumns`. Compute the remainder from the returned widths, or observe `layout.chains.get(root).spare` when using Workspace.
- Under a budget smaller than the surviving cell's minimum, the allocator preserves that minimum rather than shrinking the cell to fit; a zero budget therefore no longer hides the surviving cell.
- A split declares no `min`, `max` or `preferred` of its own; `register()` and the navigator refuse one that does (`split-with-width`). Its width follows its widest row, so a cell that opens in a row widens the split. The layout declaration schema is 2 (`LAYOUT_SCHEMA`); a server that declares splits drops their widths and sends `v=2`.
- Cell configuration now interprets `keep`, `preferred` and `elastic`. Map domain objects explicitly instead of passing unrelated properties through as layout configuration.
- Compared with the 1.1 strip, hidden interior entries no longer reserve a gap. An animated update from rest has a settling delay; departing entries can remain mounted longer. Await completion instead of assuming fixed elapsed time or immediate removal.

### Added

- Navigator and Workspace provide a branching cell shell, layout declarations, Show, compact rails, dividers, loading content, overlays, presentations and a shared time scale.
- A cell draws no title bar unless it declares `header: "title"`; the title stays its accessible name. A split may declare it too, one bar above its rows.
- A destination may declare `height: "full"`: opened from a cell in a row it stands beside the split at the full height, the shell's answer to a colspan; one breakout per split, replaced by the next. `navigator.next(occurrence)` names what follows a cell in its chain, `replay` takes a `sync` action, a split in `ifRoom` opens with its rows, and `sync` names a path into a row: after a split the next id is one of its rows.
- `VEIL_PRESENTATION` opens, closes and replaces cells by lifting and lowering a veil in the cell's own surface colour, without rotating or travelling, for workspaces with large cells. Presentation poses may carry `duration`, `easing` and `delay`, and a motion may set `follow: false` and `travel(pixels)`.

### Retained

- `CellCollection`, `CellProxy` and `CellStrip` remain exported for hosts that retain their existing renderer, subject to the compatibility changes above.

The package manifest's version is not evidence of a published release. This entry and the migration guide are prepared for a future v2 release; publication and release metadata are separate steps.
