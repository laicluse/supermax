# Supermax

Framework-free cell layout and navigation primitives for workspaces that open content below and to the right.

The package has four parts. `CellCollection` allocates one horizontal chain of cells within a budget. `CellStrip` animates such a chain. `Navigator` models a workspace whose cells can split into independent rows, with one Show control that brings back whatever hid above the window; `validateSplit` checks a split against the declared minimum height. `Workspace` renders a navigator into the DOM with the stylesheet `@laicluse/supermax/workspace.css`, and `ORIGAMI_PRESENTATION` is its default motion, with `SLIDE_PRESENTATION` as a flat alternative. Hosts own their content and their routing. A GitHub Pages demo lives in `docs/` outside the package files.

## A single row

```js
import { Navigator, Workspace } from "@laicluse/supermax";
import "@laicluse/supermax/workspace.css";

const model = new Navigator({
  root: "inbox",
  minViewportHeight: 360,
  destinations: {
    inbox: { title: "Inbox", min: 240, max: 360, compact: { min: 48 }, data: { kind: "list" } },
    "message:1": { title: "Weekly report", min: 320, max: 640, preferred: 420, defaultChild: "attachments:1", data: { kind: "message" } },
    "attachments:1": { title: "Attachments", min: 200, max: 320, data: { kind: "attachments" } },
  },
});

const workspace = new Workspace(document.querySelector("#workspace"), {
  navigator: model,
  content: (occurrence, definition, workspace) => ({ element: renderFor(definition.data, occurrence, workspace) }),
});

workspace.navigate("message:1", { from: "inbox" });
```

One row is a chain: the inbox stays on the left, the message opens beside it, its attachments open automatically when the row has room, and when the row runs out of room the inbox hides entirely until the Show control brings it back. Mark the inbox `keep: true` with a `compact` form and it stays as a rail with a peek instead; the divider between message and attachments lets the user resize for the session.

## Allocating one chain

```js
import { CellCollection } from "@laicluse/supermax";

const cells = new CellCollection([
  { id: "world", title: "Board", min: 8, max: 64, zoomable: true },
  { id: "idea", title: "Idea", min: 8, max: 64 },
]);

const layout = cells.distribute(16);
```

`distribute(budget, anchorId, { spare })` resets every cell to its minimum, hides cells from the left until the chain fits, and shares the remaining budget by `preferred` size when cells declare one, otherwise by `max` weight. When every visible cell reaches its `max` and budget remains, `spare: "stretch"` (the default) gives the rest to the cell with the largest `max`, past that max; any other value leaves the rest unallocated. The unit is whatever the caller measures in: columns or pixels. The last cell survives a shortage. `anchorId` names a `zoomable` cell that hides everything to its left. The module has no global side effects.

## Navigating branching rows

```js
import { Navigator, Workspace } from "@laicluse/supermax";
import "@laicluse/supermax/workspace.css";

const model = new Navigator({
  root: "albums",
  minViewportHeight: 360,
  destinations: {
    albums: { title: "Albums", min: 200, max: 320, data: { kind: "albums" } },
    "album:coast": {
      title: "Coast", min: 320, max: 1600,
      rows: [
        { destination: "thumbnails", minHeight: 180, maxHeight: 520 },
        { destination: "map", minHeight: 180, maxHeight: 520 },
      ],
    },
    thumbnails: { title: "Thumbnails", min: 200, max: 360, defaultChild: "photo:a", data: { kind: "selector" } },
    map: { title: "Map", min: 220, max: 480, data: { kind: "selector" } },
    "photo:a": { title: "Photo A", min: 240, max: 520, defaultChild: "metadata:a", data: { kind: "photo" } },
    "metadata:a": { title: "Metadata A", min: 200, max: 320, data: { kind: "metadata" } },
  },
});

const workspace = new Workspace(element, {
  navigator: model,
  content: (occurrence, definition, workspace) => ({ element: renderFor(definition.data, occurrence, workspace) }),
});

workspace.navigate("album:coast", { from: "albums" });
workspace.requestUp();
```

A destination is a cell definition: a title, `min` and `max` width in pixels, optionally a `defaultChild` that opens automatically when the row has room, or `rows` that split the cell into vertically stacked rows. Each row runs its own horizontal chain starting from the row's destination. `data` is the host's own payload and comes back untouched in the `content` callback. An opened destination is an occurrence whose id is the path of destination ids from the root, so the same photo opened from two rows is two occurrences with their own state.

`minViewportHeight` is the smallest window height the application supports. The navigator checks every split against it when it is created and throws a `SupermaxConfigurationError` for one that cannot fit; `validateDestinations` runs that check on its own, and a split that arrives later is checked before it opens. `spareSpace` says what happens when the cells in view have all reached their `max` and the viewport is still larger: `"stretch"` (the default) draws the largest cell past its max, and `"start"`, `"center"` or `"end"` keep every cell at its max and show the canvas beside them, with the cells aligned that way. The optional `chrome` option names the sizes that validation counts with: `navbar` (default 44) and `maxRows` per split (default 4). The workspace writes `navbar` onto its element as `--supermax-navbar`, so the stylesheet draws what the model computed. Colours come from `--supermax-ink`, `--supermax-muted`, `--supermax-line`, `--supermax-surface`, `--supermax-muted-surface`, `--supermax-canvas`, `--supermax-accent` and `--supermax-warn`, each with a fallback. Supermax writes as few words as it can, most of them only in accessible names, and they are English by default. A host that wants them in another language passes `strings` to the workspace with only the entries it replaces, each a function so every language picks its own word order. `DEFAULT_STRINGS` lists every key; an unknown key or a value that is not a function throws, so a typo never falls back to English silently.

```js
new Workspace(element, {
  navigator,
  content,
  strings: {
    up: (title) => `Toon ${title}`,
    loadFailed: (title) => `${title} kon niet laden.`,
  },
});
```

The workspace element needs a height of its own; the workspace fills it, observes its size, computes the layout, and renders cells through the `content` callback. The callback returns `{ element, update?, dispose? }`, or a promise of it for content that loads: the workspace mounts the element once, calls `update(occurrence, workspace)` after every render, and `dispose()` when the occurrence closes. `workspace.navigator.child(occurrence)` answers what is open to the right of a cell, `isAuto(occurrence)` whether it opened by itself. Hidden content stays mounted, so drafts and scroll positions survive while a cell is out of view.

`navigate(destination, { from })` is an intent. Without `onIntent` the workspace applies it itself, brings the opened content into view, moves keyboard focus to it, and returns the result. With `onIntent(action, workspace)` your layer decides what happens: call `apply(action, { focus })` on every workspace that should follow, with `focus: true` on the one that received the click. That is how the demo drives two workspaces from one click. `replay(actions)` rebuilds a workspace from a list of actions and renders once; `restore(snapshot)` puts back a `navigator.snapshot()` and returns false when the snapshot names destinations that no longer exist. The workspace emits `rejected` when the model refused an action, `change` after every action, `render` with the computed layout, and `size`, `peek`, `content`, `modal`, `notice` and `presentation` for the features of the same names. `requestUp()`, the Show control, brings back the nearest parent of the focused cell that is out of view, or else of the branch opened before it, and focuses it, closing as many cells at the end of that chain as the shown cell needs; it stays local to its workspace and emits `up` so a host can record the step in its history. Alt+ArrowLeft inside the workspace is the Show control, and the ancestors in the title are links that focus that cell.

A destination may also declare `keep: true` with an optional `compact: { min, content? }` (it stays in view, as a narrow rail with a peek when space runs out, see the guide), `preferred` (its share when the chain has room beyond every minimum; dividers between cells let the user override it for the session). A destination that is not embedded in the page opens once its layout declaration is registered with `navigator.register(set)`; `readLayout(response)` reads one from a `Supermax-Layout` header. A promise from the `content` callback gives a cell that loads, with built-in loading and error states and a Retry control.

The workspace also opens a modal that knows its source cell (`openModal`), shows feedback with a scope (`notify`), reloads content (`reload`), and takes a `presentation` that replaces motion and surface while behaviour and accessibility stay. The navigation contract (the window and Show, groups, auto-opening, validation, deep links, kept cells, sizes, loading, modals, notices, presentation) is written down in the [application-shell guide](docs/application-shell.md).

## Demo

The demo in `docs/` shows two freely resizable frames side by side. Every click reaches both; each frame computes its own layout and auto-opening from its own size, and keeps its own window. Its controls switch network delay, failures and viewer for the loading cells, and the presentation between slide and fold.

![Wide and narrow frames with the three-row album](docs/assets/captures/three-rows.png)

![A short frame hides the top rows until Show brings them back](docs/assets/captures/short-frame.png)

![The fold presentation restyles the same layout](docs/assets/captures/fold.png)

Regenerate the captures with `node scripts/capture-demo.mjs`.

## Animated presentation

```js
import { CellStrip } from "@laicluse/supermax";

const strip = new CellStrip(viewport);
await strip.update([
  { id: "board", element: boardElement, width: 320, visible: false },
  { id: "idea", element: ideaElement, width: 320, visible: true },
]);
```

Supply pixel widths from the allocator, using each hidden cell's minimum width rather than zero. The viewport clips one continuous horizontal strip. Ancestors slide left as children enter from the right; removing children reverses that movement. Width changes and strip movement share a 200ms `cubic-bezier(0.25, 0.1, 0.25, 1)` timeline. Override `duration` and `easing` in the constructor when needed.

The first update and reduced-motion updates paint immediately. Subsequent updates continue from the current rendered position, including interrupted transitions and viewport resizing. Call `update(entries, { animate: false })` for an immediate layout. Its returned promise, also available as `strip.finished`, resolves when that update finishes or is superseded.

Keep cell IDs stable when replacing content. Removed cells become inert immediately but remain mounted through their exit, marked with `data-supermax-exiting`; do not remove them before calling `update`. Hidden ancestors likewise become inert immediately and become visually hidden only after their transition. Existing `display: contents` wrappers inside the public `strip.strip` element are preserved. Headers and bodies can share the same cell element to move together. Call `destroy()` when disposing the host; it removes the strip and restores the viewport's previous overflow style.

## Development

Supermax is package-manager agnostic. The package is developed with pnpm as the primary lockfile owner; the model tests also run under Bun, and the browser scenarios use Playwright with Chrome (`pnpm exec playwright install chrome` if Chrome is missing):

```sh
corepack pnpm run serve
corepack pnpm run build:docs
corepack pnpm run check
corepack pnpm run test:browser:fold
```

`serve` builds the docs and serves the demo at `http://127.0.0.1:8260` (`PORT` overrides it) with `Cache-Control: no-store`, so a reload always runs the current build; a plain static server lets the browser keep the previous modules. The last line runs the browser suite under the fold presentation; `check` runs it under the default presentation only.
