# Supermax

Framework-free responsive cell layout primitives for left-to-right drilldown interfaces.

The public package surface is intentionally small: `src/cell-collection.js` is the source of truth, and hosts bundle that package into their own artifacts when they need a standalone browser file. A GitHub Pages demo lives in `docs/` outside the package files.

## Usage

```js
import { CellCollection } from "@epologee/supermax";

const cells = new CellCollection([
  { id: "world", title: "Board", min: 8, max: 64, zoomable: true },
  { id: "idea", title: "Idea", min: 8, max: 64 },
]);

const layout = cells.distribute(16);
```

The package also assigns `globalThis.Supermax` for hosts that bundle the module into a browser artifact and still need a global compatibility surface.

## Development

Supermax is package-manager agnostic. The package is developed with pnpm as the primary lockfile owner, and the same smoke test also runs under Bun:

```sh
corepack pnpm run build:docs
corepack pnpm test
bun run test:bun
```
