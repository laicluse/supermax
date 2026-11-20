---
name: supermax
description: >-
  Build on Supermax the way it is meant to be used: the per-click contract, which feature fits which need, and what a host never does. Use whenever Supermax, @laicluse/supermax, supermax- classes or a Supermax Workspace come up.
---

# Building on Supermax

Supermax (`@laicluse/supermax`) is an application shell: a `Navigator` decides what is open, a `Workspace` renders it as cells in branching rows and moves them. A host owns its content, its routing and its data, and follows the contract below so that every app moves the same way. This skill holds the contract and when to use each feature. Signatures and options live in the installed package, so read them there before you call anything:

- `node_modules/@laicluse/supermax/README.md`, section "Workspace reference": every workspace method with all its options.
- `node_modules/@laicluse/supermax/docs/application-shell.md`: the behaviour behind them (window and Show, groups, loading layout, modals, notices, motion, time).
- For a major upgrade, inventory the host's existing contracts and read `docs/migrating-to-v2.md` from the target package or its matching release notes; a v1 install lacks it. Retaining `CellCollection` or `CellStrip` does not require adopting `Workspace`.

When the package is linked from a checkout (`file:`), the same files are in that checkout.

## The contract per click

1. **Pass the clicked element as `origin`** to every `navigate`, `apply`, `sync` and `depart` that comes from a click. A replaced cell folds away towards the new click, compared with the click that opened it; without an origin it folds on its far edge. Pass `origin: null` when nothing was clicked (a route change, a keyboard shortcut, a timer).
2. **Pass `from` to `openModal`**: the occurrence the modal belongs to, so a frustum links them. `from: null` for a modal that belongs to no cell.
3. **Know the layout before you open.** A split declares a title and `rows` only, never a width: its width follows what is open in its rows. Every destination the page does not embed needs its layout declaration registered first: `navigator.register(await readLayout(response))`, from a `HEAD` the server answers with a `Supermax-Layout` header.
   - Prefetch it when a pointer rests on a link for about 100 ms.
   - Keep one in-flight promise per destination and viewer context; a click waits on that same promise instead of sending a second request.
   - A deep link or reload asks for every layout it needs in one batch, then renders once without motion.
4. **While the layout is on its way, call `depart`**, so the cells the click replaces fold away in their rooms instead of nothing happening. When every declaration is already known, skip `depart` and call `sync` (or `navigate`) at once. When the layout fails, call `cancel()` on the handle `depart` returned. Offer a Retry only for a failure that can pass, a network error or a 5xx; a declaration that `register` refuses (`SupermaxConfigurationError`, for example a `context` that differs from the navigator's) fails the same way every time, so log it as the host bug it is.
5. **One render per click.** Make one `sync` or `navigate` per user action. Never call `sync`, `navigate` or `render` from a `render` or `zoom` event handler; react to the event without rendering again.

The workspace warns once per kind in the console when a host leaves out an `origin` for a replacement or a departure, a `from` for a modal, or renders from a render handler. Treat such a warning as a bug in the host.

## Which feature, when

- **`sync(destinations, { origin, ifRoom })`**: the host knows the whole chain, for example from its URL. One call per navigation; it keeps what is shared and renders once. After a split the next id names one of its rows and the chain continues inside it, so a cell inside a row that the URL names is synced, not navigated to in a second render.
- **`ifRoom`**: a cell that should open only when the window has room for it, such as a detail pane next to a list. It is an ordered chain; the longest beginning that fits without hiding a cell in view opens, as automatic cells that a later explicit sync or click promotes, and that a later sync without them in its `ifRoom` closes. It never opens on resize. Cells that only make sense together, such as a conversation's metadata and its messages, go in as one nested list, `ifRoom: [["metadata:1", "messages:1"]]`, so they open whole or not at all.
- **`navigate(destination, { from, origin })`**: a click inside a cell's content that opens something to its right, or beside the split when the destination declares `height: "full"` and the click came from a row, when the host does not keep the chain itself.
- **Content handle `{ element, header?, update?, leave?, dispose? }`**:
  - `header`: the content's own controls (search, sort, zoom) in the cell header;
  - `update`: refresh after every render;
  - `leave()`: stop writing shared state the moment a cell starts to close, because it stays mounted while it folds away;
  - `dispose()`: clean up once it is gone.
- **`header: "title"` on a destination**: the exception, not the rule. A cell has no title bar; declare `header: "title"` only for a cell a viewer cannot place from its content, such as a list of edit names or a cell with one control. A strip of thumbnails, a map, a photo, a conversation's messages under the split's own bar need none; a title bar on every cell wastes a line and a glance each. Never hide or add `.supermax-cell-title` with host CSS.
- **Titles**: a cell's title, and with it the bar's title, names the content the cell shows, such as the vault's name, a conversation's subject or "3 open todos", never its role in the structure, such as "Viewer", "Detail" or "List". The host supplies it; declare it with the content's name, and use `setTitle(occurrence, title)` when that name or a count is known or changes after the cell opened.
- **The `show` event**: cancelable before Show closes cells; prevent it to keep an unsaved form open. The `up` event names the closed cells in `detail.closed`, with destinations, so the host can record the step in its history.
- **`zoom(occurrence)`**: a cell that should take the width of the cells before it, for a destination declared `zoomable: true`. Draw the toggle in the content's `header`. When a sync replaces the zoomed cell, for example after archiving it, pass `zoom` with the destination that stays zoomed, so the cells before it never flash into view.
- **`height: "full"` on a destination**: content that needs the full height, such as an attachment opened from the attachments row of a conversation. From a cell in a row it opens beside the split instead of inside the row, keeps that cell as its origin (`navigate(destination, { from: rowCell, origin })`), and one such cell stands beside a split at a time. A deep link that ends in it is one `sync` whose destinations run through the split, its row and the row cell to the full-height id, the occurrence's own path; `navigator.next(split)` names the cell beside a split.
- **`openModal`**: the modal in "Control, modal or cell" below, opened with `from` set to the cell it is about.
- **`notify`**: feedback with a scope: `scope: "cell"` with a `source` for something a cell did, `scope: "workspace"` for the whole app.
- **Peek and a compact rail**: a menu that must stay reachable when space runs out. Declare `keep: true` with `compact: { min }`, and give the rail its icons through the workspace's `compactContent(occurrence, workspace)` option, also when the declaration comes from the server. A menu as an icon rail is what lets a phone show it next to the first content.
- **`TimeScale`**: one scale for every millisecond. Pass one `time` to every workspace, scale the host's own waits with `time.ms(milliseconds)`, and write the host's own CSS durations with `time.paint(element, { times, easings, prefix })`.
- **`layout.chains.get(root).spare`** (from the `render` event or `findChain`): the width a chain leaves unused, for a host that fills free space with something other than a cell.

## Control, modal or cell

Use the installed application-shell guide's "Controls, modals and task cells" for the complete rule and sources. Decide by task length, frequency, risk, recoverability and need for context, never by an HTML form, field count or existing presentation:

- **Control in place:** direct actions and compact contextual inputs stay where the task happens; feedback is proportional and confirmation is reserved for risk that justifies interrupting. Easily reversible toggles need none.
- **Modal:** a short, bounded, infrequent task that benefits from blocking; use `openModal` with its source `from`.
- **Cell:** substantial editing, steps, drafts, detail or comparison; a task that needs surrounding content must not block it in a modal. Content that needs the full height, such as an attachment listed in a row, is a cell declared `height: "full"` beside the split, not a modal and not a cell squeezed into the row.
- **Disclosure:** extra reading information, without unfolding a new editor between reading content.

Preserve choices, defaults, pending/result feedback, errors and recovery when moving an interaction. The host owns focus entry, return and modal containment; Supermax moves no focus itself.

## What a host never does

- **Call internal methods** such as `navigator.fits`, `openIfRoom`, `openDefaults` or the strip's methods. Use the documented route (`sync` with `ifRoom`); if none exists, ask for one in Supermax instead of reaching inside.
- **Build its own modal structure**, or move controls into `.supermax-*` elements after mount. Use `openModal` and the content's `header`.
- **Label a source next to the frustum** ("From …"). The frustum shows it, and the dialog describes it to assistive technology.
- **Animate cells, rooms, rows or the strip itself**, with CSS transitions or Web Animations on `.supermax-cell`, `.supermax-room`, `.supermax-row` or `.supermax-strip`. Motion belongs to the presentation; a host that needs different motion supplies a `presentation`, such as `VEIL_PRESENTATION` when its cells are large enough that origami's fold moves a screen of content.
- **Rely on `position: fixed` inside cell content.** Cells and the strip carry transforms, so a fixed element positions against them, not the viewport. Move a popover to `document.body` or into the overlay root.
- **Repeat a signature in its own docs or instruction files.** Point at the package docs above, so an upgrade cannot leave a stale copy behind.
