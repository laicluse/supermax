# Supermax

Framework-free responsive cell layout primitives for left-to-right drilldown interfaces.

The package separates cell allocation (`CellCollection`) from animated presentation (`CellStrip`). Hosts own route selection and cell content. A GitHub Pages demo lives in `docs/` outside the package files.

## Usage

```js
import { CellCollection } from "@laicluse/supermax";

const cells = new CellCollection([
  { id: "world", title: "Board", min: 8, max: 64, zoomable: true },
  { id: "idea", title: "Idea", min: 8, max: 64 },
]);

const layout = cells.distribute(16);
```

The package also assigns `globalThis.Supermax` for hosts that bundle the module into a browser artifact and still need a global compatibility surface.

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

Browser scenarios use Playwright with Chrome. Run `pnpm exec playwright install chrome` if Chrome is not already installed, then `pnpm test`.

## Application design

The allocator deliberately does not render an interface, but a Supermax application still follows a shared interaction model. Read the [application-shell guide](docs/application-shell.md) before adapting an existing application. It defines the cell hierarchy, cell anatomy, control placement, width semantics, routing, and cold-start behavior that make separate consumers behave like the same system.

## Development

Supermax is package-manager agnostic. The package is developed with pnpm as the primary lockfile owner, and the same smoke test also runs under Bun:

```sh
corepack pnpm run build:docs
corepack pnpm test
bun run test:bun
```
