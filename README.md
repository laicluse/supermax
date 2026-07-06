# Supermax

Framework-free responsive cell layout primitives for left-to-right drilldown interfaces.

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
corepack pnpm test
bun run test:bun
```
