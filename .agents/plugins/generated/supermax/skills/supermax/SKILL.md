---
name: supermax
description: >-
  Build on Supermax the way it is meant to be used: the per-click contract, which feature fits which need, and what a host never does. Use whenever Supermax, @laicluse/supermax, supermax- classes or a Supermax Workspace come up.
---

# Building on Supermax

Supermax (`@laicluse/supermax`) is an application shell: a `Navigator` decides what is open, a `Workspace` renders it as cells in branching rows and moves them. A host owns its content, its routing and its data, and follows the contract below so that every app moves the same way. This skill holds the contract and when to use each feature. Signatures and options live in the installed package, so read them there before you call anything:

- `node_modules/@laicluse/supermax/README.md`, section "Workspace reference": every workspace method with all its options.
- `node_modules/@laicluse/supermax/docs/application-shell.md`: the behaviour behind them (window and Show, groups, loading layout, modals, notices, motion, time).

When the package is linked from a checkout (`file:`), the same files are in that checkout.

## The contract per click

1. **Pass the clicked element as `origin`** to every `navigate`, `apply`, `sync` and `depart` that comes from a click. A replaced cell folds away towards the new click, compared with the click that opened it; without an origin it folds on its far edge. Pass `origin: null` when nothing was clicked (a route change, a keyboard shortcut, a timer).
2. **Pass `from` to `openModal`**: the occurrence the modal belongs to, so a frustum links them. `from: null` for a modal that belongs to no cell.
3. **Know the layout before you open.** Every destination the page does not embed needs its layout declaration registered first: `navigator.register(await readLayout(response))`, from a `HEAD` the server answers with a `Supermax-Layout` header.
   - Prefetch it when a pointer rests on a link for about 100 ms.
   - Keep one in-flight promise per destination and viewer context; a click waits on that same promise instead of sending a second request.
   - A deep link or reload asks for every layout it needs in one batch, then renders once without motion.
4. **While the layout is on its way, call `depart`**, so the cells the click replaces fold away in their rooms instead of nothing happening. When every declaration is already known, skip `depart` and call `sync` (or `navigate`) at once. When the layout fails, call `cancel()` on the handle `depart` returned. Offer a Retry only for a failure that can pass, a network error or a 5xx; a declaration that `register` refuses (`SupermaxConfigurationError`, for example a `context` that differs from the navigator's) fails the same way every time, so log it as the host bug it is.
5. **One render per click.** Make one `sync` or `navigate` per user action. Never call `sync`, `navigate` or `render` from a `render` or `zoom` event handler; react to the event without rendering again.

The workspace warns once per kind in the console when a host leaves out an `origin` for a replacement or a departure, a `from` for a modal, or renders from a render handler. Treat such a warning as a bug in the host.

## Which feature, when

- **`sync(destinations, { origin, ifRoom })`**: the host knows the whole root chain, for example from its URL. One call per navigation; it keeps what is shared and renders once.
- **`ifRoom`**: a cell that should open only when the window has room for it, such as a detail pane next to a list. It is an ordered chain; the longest beginning that fits without hiding a cell in view opens, as automatic cells that a later explicit sync or click promotes. It never opens on resize. Cells that only make sense together, such as a conversation's metadata and its messages, go in as one nested list, `ifRoom: [["metadata:1", "messages:1"]]`, so they open whole or not at all.
- **`navigate(destination, { from, origin })`**: a click inside a cell's content that opens something to its right, when the host does not keep the chain itself.
- **Content handle `{ element, header?, update?, leave?, dispose? }`**:
  - `header`: the content's own controls (search, sort, zoom) in the cell header;
  - `update`: refresh after every render;
  - `leave()`: stop writing shared state the moment a cell starts to close, because it stays mounted while it folds away;
  - `dispose()`: clean up once it is gone.
- **`setTitle(occurrence, title)`**: a title that changes after the cell opened, such as a count.
- **The `show` event**: cancelable before Show closes cells; prevent it to keep an unsaved form open. The `up` event names the closed cells in `detail.closed`, with destinations, so the host can record the step in its history.
- **`zoom(occurrence)`**: a cell that should take the width of the cells before it, for a destination declared `zoomable: true`. Draw the toggle in the content's `header`.
- **`openModal`**: a short task about what one cell shows, opened with `from` set to that cell, such as a confirmation or a quick contextual edit of a few fields; see "Where an edit lives" below. The size and content of the task decide, not whether the app had a dialog before. Never use it for content that reads as a cell, such as a list, a detail or a longer process: that is a destination opening as a cell.
- **`notify`**: feedback with a scope: `scope: "cell"` with a `source` for something a cell did, `scope: "workspace"` for the whole app.
- **Peek**: a menu that must stay reachable when space runs out. Declare `keep: true` with `compact: { min, content? }`.
- **`TimeScale`**: one scale for every millisecond. Pass one `time` to every workspace, scale the host's own waits with `time.ms(milliseconds)`, and write the host's own CSS durations with `time.paint(element, { times, easings, prefix })`.
- **`layout.chains.get(root).spare`** (from the `render` event or `findChain`): the width a chain leaves unused, for a host that fills free space with something other than a cell.

## Where an edit lives

A cell holds one kind of content for one task, as the guide's "one data owner and one responsibility". A reading cell stays a reading cell, so an edit or create form never unfolds inside it.

- **A short contextual edit**, a few fields or a confirmation about what the cell shows: `openModal` with `from` set to that cell.
- **A substantial edit or create process**, with its own steps, a draft or a longer form: a registered destination that opens as a deeper cell to the right of the cell it edits.
- **Disclosure** (`<details>`, an accordion, a "show more") only reveals extra reading information that leaves the cell's task unchanged. A `<details>` or accordion that unfolds an edit or create form inside a reading cell is the in-place editing this rule excludes.

## What a host never does

- **Call internal methods** such as `navigator.fits`, `openIfRoom`, `openDefaults` or the strip's methods. Use the documented route (`sync` with `ifRoom`); if none exists, ask for one in Supermax instead of reaching inside.
- **Build its own modal structure**, or move controls into `.supermax-*` elements after mount. Use `openModal` and the content's `header`.
- **Label a source next to the frustum** ("From …"). The frustum shows it, and the dialog describes it to assistive technology.
- **Animate cells, rooms, rows or the strip itself**, with CSS transitions or Web Animations on `.supermax-cell`, `.supermax-room`, `.supermax-row` or `.supermax-strip`. Motion belongs to the presentation; a host that needs different motion supplies a `presentation`.
- **Repeat a signature in its own docs or instruction files.** Point at the package docs above, so an upgrade cannot leave a stale copy behind.
