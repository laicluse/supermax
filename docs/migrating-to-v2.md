# Migrating from v1 to v2

This guide is for people and coding agents upgrading `@laicluse/supermax`, including a dependency sweep that encounters a major update. It compares the v1 allocator and the v1.1 animated strip with the prepared 2.0.0 package. Inventory the currently installed source, then read the guide shipped with the target v2 package or linked by its matching release notes. A v1 installation does not contain this guide, and a repository branch can be newer than the target in a lockfile.

This is a prepared migration guide, not a release announcement. The repository's 2.0.0 manifest does not establish that a v2 release is available from a registry or that this branch has been published.

## Choose the migration lane

First inventory imports, bundled or embedded copies, globals, allocator result fields, strip calls, layout configuration, DOM/CSS dependencies and the host's routing and focus logic. Check the lockfile and the actual installed source as well as `package.json`; a Git commit, a local `file:` dependency and a registry version are different sources.

- **Retain the primitives.** Keep `CellCollection`, `CellProxy` and, if used, `CellStrip`, with the host's current renderer and router. Apply the compatibility changes below. Installing v2 does not require a shell rewrite.
- **Adopt the shell.** Use `Navigator` and `Workspace` when the host is deliberately moving responsibility for cell layout, navigation and presentation into Supermax. This is an application migration as well as a dependency upgrade. Do not remove existing user capabilities merely because the new shell renders without errors.

The decision depends on existing responsibilities, not on whether an application resembles a demo. The same inventory and verification apply to any domain, framework, route depth or number of independent rows. A code example illustrates a contract; it is not the set of supported applications.

## Compatibility map

| v1 contract | v2 status | Required action |
| --- | --- | --- |
| Named `CellCollection` and `CellProxy` imports from the root or `/cell-collection` | Retained | Keep them when retaining the allocator. Prefer the subpath when the host needs only the allocator; the v2 root also imports the shell modules. |
| `CellProxy` getters `id`, `title`, `min`, `max`, `zoomable`, `visible`, plus `config` and `actual` | Retained; `preferred` and `elastic` added | No callback migration is needed: the v1 proxy did not provide callbacks. |
| `new CellCollection(configs)` and `distribute(budget, anchorId)` | Retained with boundary changes below | Keep numeric bounds and the host's measurement unit; do not copy Workspace's `max: "*"` into this low-level API. |
| Weighted distribution, left-to-right hiding, zoom anchor, hidden count and rightmost hidden title | APIs retained; zero-budget metadata changes | Keep the host's corresponding controls in the primitive lane, accounting for the zero-budget case below. In the shell lane, use Workspace's Show and zoom rather than building competing controls. |
| `globalThis.Supermax` after loading a bundle | Removed, with no automatic global successor | Import named exports explicitly. If an external script genuinely requires a global, create that boundary in the host's bundle; no package side effect recreates it. |
| `result.spareColumns` | Removed, with no same-shaped allocator property | Compute `budget - result.cells.reduce((sum, cell) => sum + cell.actual, 0)`. Preserve a negative result as overflow. Workspace instead exposes unused chain width through `layout.chains.get(root).spare`. |
| Last cell shrinks below `min` to fit a very small budget | Changed: the surviving cell keeps its minimum | Handle insufficient space explicitly; do not assume the sum of widths is at most the budget. Workspace exposes its below-minimum/overflow state and allows emergency scrolling. |
| Zero budget hides every cell | Changed: the surviving cell remains visible at its minimum; `hiddenCount` and `rightmostHiddenTitle` change too | If the host must render nothing at zero size, clear the strip with `update([], { animate: false })` or hide its host. Merely skipping an update leaves the previous content mounted. Every supplied strip entry still needs a positive width, including hidden entries; that constraint already existed in 1.1. |
| Arbitrary extra properties in a cell configuration | `keep`, `preferred`, `elastic` now have layout meaning | Project domain objects onto intentional layout fields. One `preferred` field changes the allocation algorithm for the whole chain. A nonnumeric domain value such as `preferred: "high"` can produce `NaN` widths and a later `Invalid cell width` error in the strip. These fields are not harmless metadata. |
| `CellStrip` root and `/cell-strip` imports from the 1.1 source line | Retained | Keep the strip if retaining the host renderer. The 1.0 source line did not include this class. |
| `strip.update(entries, { animate })`, `strip.finished`, `strip.destroy()`, `duration` and `easing` | Retained with timing/layout changes below | Preserve stable IDs and await completion. Do not depend on undocumented mutable animation arrays or helper methods. |
| Pixel entry widths, inert hidden content, exit marker, same-ID replacement, `display: contents` wrappers, interrupted motion and overflow restoration on destroy | Retained in the original strip browser scenarios | Exercise the same behavior with the host's content and CSS as well. |
| Hidden entries between visible strip entries reserve their old gap | Changed: interior hidden entries settle at zero width | Do not use a hidden entry as a spacer. Leading hidden ancestors still keep their width for the translated offset. |
| An animated strip starts moving immediately and a removal may complete synchronously | Changed: settling delay and longer mounted exits | Await `update()`/`finished`; keep removed elements until Supermax completes the exit. A standalone strip accepts `settle: 0` if immediate start is required, but removal remains asynchronous. Do not key navigation or disposal to a hard-coded 200 ms timeout. |
| Host styling of strip-managed `visibility` and `position` | May interact differently | The strip now has relative positioning and clears inline visibility while placing entries. Remove conflicting hidden-state rules from managed cells, and test inherited visibility and positioned descendants. |
| Host-provided routing, focus, shortcuts, scroll ownership and content rendering | Still host responsibilities unless explicitly moved | Inventory them before deleting old code. New shell APIs do not infer product routes, move focus, install shortcuts or migrate application state. |

There is no automatic successor for the old global assignment or the old allocator result property. Their migration paths above are explicit host changes. The lost below-minimum fit guarantee is a deliberate behavior change. The remaining documented v1 primitives were not removed in the audited source lines.

## Adopting Navigator and Workspace

For current signatures, use the installed [README](../README.md#workspace-reference); for interaction semantics, use the [application-shell guide](application-shell.md). Do not substitute an earlier migration note for the installed API reference.

1. **Map responsibilities and states.** Describe the application's destinations, their parent-child relationships, independent rows, current route, selected item, defaults, drafts and focus. Inventory every action and empty, loading, error and permission state. Preserve their outcomes through the migration.
2. **Declare the layout.** Navigator dimensions are pixels. Give the workspace element a real height and import `@laicluse/supermax/workspace.css`. Declare at least one elastic destination with `max: "*"` and `preferred`; each split needs exactly one elastic row and its preferred height. Validate against the supported minimum height. A split inside a row is rejected; do not discover that restriction only after replacing the old renderer.
3. **Keep identity separate from occurrences.** Destination IDs must not contain `/`; encode parameters before constructing an ID. An occurrence identifies one opening along its ancestry. Shared data may belong to the destination, while draft, scroll and selection state can belong to an occurrence. The same destination opened from two rows is not one mounted view.
4. **Register before navigating.** A destination not embedded at startup needs a validated declaration before it opens. Fetch layout declarations in the host, typically through HEAD and `readLayout`, then register them. Batch the initial route's declarations and share in-flight requests between hover-prefetch and clicks. An offline artifact must embed validated declarations instead of depending on an unavailable server.
5. **Mount content through handles.** Return `{ element, header?, update?, leave?, dispose? }` or its promise. Put content controls in `header`. Stop state writes in `leave`; release resources in `dispose`. Closing content remains mounted during its exit, and a returning cell can reuse its content. Keep one scroll owner per body and preserve drafts while ancestors are merely hidden.
6. **Reconcile the route once.** For a host-owned root chain, use `workspace.sync`. Use `navigate` with `from` when opening from a particular occurrence; a branched layout may need the appropriate row's source rather than a single root-chain sync. Pass the target `zoom` in the same `sync` when a route changes both chain and focus; a valid Navigator snapshot can instead be restored with `workspace.restore(snapshot)`. Browser history remains the host's. Restore routes without animation and distinguish a hidden ancestor from a closed destination. Do not add a second sync from `render` or `zoom` handlers.
7. **Preserve optional groups and pending navigation.** Use `ifRoom` only for optional content; nest dependent destinations into a group that opens whole or not at all. If new declarations are pending, call `depart` and cancel it on failure or superseding intent. A known destination goes straight to one navigation render. Retry transient network/5xx failures, not an invalid declaration.
8. **Carry intent and interaction context.** Pass the clicked element as `origin`, or `null` for route/keyboard/timer actions. Use `from` for a contextual modal. Preserve control outcomes and required confirmations; a simple button, toggle or compact input needs no new space, a bounded interruption can use a modal, and substantive work belongs in its own cell. The host manages focus entry/return, modal focus containment, shortcuts and dirty-form guards.
9. **Rebuild the actual consumer.** Regenerate every embedded bundle, stylesheet and standalone artifact that ships to users, then restart the appropriate runtime. A local file dependency may be an installed snapshot rather than a live view of the source checkout; compare the installed files before trusting a build. Verify the served artifact, not just the source tree.

## Limits to resolve before removing host behavior

- The modal host offers no public non-dismissible/before-close guard for a mutation that must keep blocking the app. Do not replace a required blocking progress flow with a freely dismissible modal and silently lose that constraint.
- Supermax provides modal structure and makes background cells inert, but leaves focus, focus containment and keys to the host. Verify the complete accessible interaction.
- Runtime JS validation is available; the audited package does not ship TypeScript declarations. They were not a v1 feature either.

These are present adoption limits, not evidence that v1 once supplied a Workspace or modal capability. Keep a needed host implementation until its responsibility has an adequate successor.

## Verify the migration as a product

Use actual host tasks at supported wide and narrow sizes, including a budget below the cell minimum. Verify direct links, reload, Back/Forward, selection continuity, hidden-ancestor recovery, zoom, optional groups, independent rows and their shared destinations. Exercise create/edit, unsaved data, superseded navigation, slow/failed declarations, retries, and repeated actions. Check that every old control still has a reachable outcome, with equivalent focus and keyboard behavior.

For the primitive lane, compare returned allocation fields and narrow-budget behavior, interior hidden entries, interrupted updates, same-ID content replacement, exit/disposal and reduced motion. For the shell lane, also inspect inherited CSS, stacking and popovers: transformed cells change the containing block of fixed descendants, so viewport popovers need an appropriate overlay root.

Check console warnings, page errors and actual captures with representative content. Run the host's tests against the rebuilt artifact. A green package suite does not establish a successful application migration or faster rendering. Measure performance on equivalent start/end states and repeated runs; opening more content or replacing zoom with a modal is not a valid speed comparison.

Finish a dependency update with the exact installed source/version, the chosen lane, applicable compatibility changes, tested tasks and any unresolved gap. A blocker stays explicit; it is not a reason to discard a user capability to get a green build.

## Audit evidence and scope

The source comparison was performed on 23 October 2026 against these repository snapshots, identified by their manifests rather than assumed registry releases:

| Source snapshot | Package manifest | Scope |
| --- | --- | --- |
| `306fce6` | 1.0.0 | Allocator, proxy and global compatibility assignment |
| `f2f4cc7` | 1.1.0 | The allocator plus animated CellStrip |
| `92dfacd` | 2.0.0 | Current retained primitives and the new shell |

For configs `[{ id: "list", title: "List", min: 4, max: 10 }, { id: "detail", title: "Detail", min: 8, max: 20 }]`, importing each snapshot's allocator and calling the same input produced:

| Budget | v1 widths | v2 widths | v1 `spareColumns` | v2 equivalent | Hidden count / title (v1 → v2) |
| --- | --- | --- | --- | --- | --- |
| 0 | `[0, 0]` | `[0, 8]` | 0 | Compute remainder: -8 | `2 / Detail` → `1 / List` |
| 3 | `[0, 3]` | `[0, 8]` | 0 | Compute remainder: -5 | `1 / List` → `1 / List` |
| 8 | `[0, 8]` | `[0, 8]` | 0 | Compute remainder: 0 | `1 / List` → `1 / List` |
| 20 | `[6.666…, 13.333…]` | `[6.666…, 13.333…]` | 0 | Compute remainder: 0 | `0 / null` → `0 / null` |
| 40 | `[10, 20]` | `[10, 20]` | 10 | Compute remainder: 10 | `0 / null` → `0 / null` |

At budget zero, `cells[].visible` changes from `[false, false]` to `[false, true]`. The metadata change can therefore affect a host's hidden-cell count or Show label as well as its geometry.

The original `f2f4cc7:test/cell-strip.test.js` was run against the current modules and passed. This covers its original scenarios, not every possible CSS integration or host workflow. The compatibility map also records additional source and browser checks for interior hidden entries and timing. No additional unintended core regression was established by this audit; the confirmed breaks above still require migration work. The current package tests alone must not be read as proof of application parity.

To repeat the allocator comparison in a repository checkout, obtain the old source with `git show 306fce6:src/cell-collection.js`, import it in an isolated module/process, and compare the same configurations and budgets with `src/cell-collection.js`. For strip parity, run the original browser test with its module requests pointed at the candidate's `src/` directory. Preserve the original assertions; changing an assertion changes what the comparison proves.

## Discovery during dependency updates

The guide ships in the package and is linked from the root README, the versioned changelog entry and the optional agent skill. Consumers need no plugin or access to an author's local setup to read it. This supports manual and agent-led updates through the same public material.

The release path must preserve these links: retain the package's `repository` metadata, publish versioned release notes with a prominent migration-guide link, and include the guide in the distributed package. [Renovate documents](https://docs.renovatebot.com/key-concepts/changelogs/) how repository metadata, releases and conventional changelog files bring upgrade information into dependency PRs. [Astro's major upgrade guide](https://docs.astro.build/en/guides/upgrade-to/v5/) demonstrates separating breaking changes, removals, changed defaults and the required consumer action. This guide uses that explicit change-to-action structure.

Those are established discovery mechanisms, not a guarantee that every bot or coding agent reads the guide. Package contents and an independent guide-only migration exercise must be checked before claiming the material is sufficient for a particular consumer. Publishing a release and testing a real dependency bot remain separate from preparing these files.
