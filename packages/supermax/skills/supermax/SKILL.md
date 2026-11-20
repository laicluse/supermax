---
name: supermax
description: >-
  Build on Supermax the way it is meant to be used: task-led horizontal and vertical composition, the per-click contract, and what a host never does. Use whenever Supermax, @laicluse/supermax, supermax- classes or a Supermax Workspace come up.
user-invocable: true
---

# Building on Supermax

Supermax (`@laicluse/supermax`) is an application shell: a `Navigator` decides what is open, a `Workspace` renders it as cells in branching rows and moves them. A host owns its content, its routing and its data, and follows the contract below so that every app moves the same way. This skill guides spatial design and holds the contract and when to use each feature. Signatures and options live in the installed package, so read them there before you call anything:

- `node_modules/@laicluse/supermax/README.md`, section "Workspace reference": every workspace method with all its options.
- `node_modules/@laicluse/supermax/docs/application-shell.md`: the behaviour behind them (window and Show, groups, loading layout, modals, notices, motion, time).
- For a major upgrade, inventory the host's existing contracts and read `docs/migrating-to-v2.md` from the target package or its matching release notes; a v1 install lacks it. Retaining `CellCollection` or `CellStrip` does not require adopting `Workspace`.

When the package is linked from a checkout (`file:`), the same files are in that checkout.

## Understand the spatial model

Read the installed guide's **Vocabulary**, **Start with the cell path**, **Rows** and **The window and Show** before designing the hierarchy. Think in tasks and relationships, then express them as:

```text
root -> collection -> item split                 -> full-height task
                         | source row -> detail     (opened from a row)
                         ` activity row -> event
```

A destination defines content and layout; an occurrence is that destination at a particular path, with its own local state. A chain opens children to the right. A split gives independent branches their own rows and horizontal chains; it opens in the root chain, never inside a row. Rows belong to their split and do not close independently. A full-height destination opened from a row stands beside the split; each split has one such breakout at a time, whose chain may continue to the right.

**Open is not the same as visible.** Allocation hides or folds cells and rows without disposing them; drafts and selection remain. Resize changes the visible window, not the open hierarchy. Show recovers hidden earlier context: horizontally it can close trailing cells to make room, while vertically it moves the row window. Clicking a fold cue trades space with neighbouring content while both remain open. Closing has lifecycle and draft consequences; the host owns protection and history. Read **The window and Show**, **Navigation groups** and **Deep links and browser history** for the precise behavior rather than treating Show as browser Back.

## Compose around the user's work

For a new shell or an adaptation, produce the design proposal yourself from existing task analyses, design decisions, routes, code, real content and captures. Read the project's design research before reducing its intent to today's implementation. Distinguish observed behavior, accepted decisions, exploratory proposals and assumptions; verify their date and current relevance. Captures establish visible presentation, not frequency, scope or hidden behavior. Follow the guide's **Adaptation checklist** for implementation coverage; when upgrading existing Supermax contracts, also use the target package's migration guide.

### Inventory and choose

Map reachable tasks and their information and controls, including reading, comparison, creation, editing, drafts and recovery. Record ownership and scope, importance, frequency, data density, required simultaneous context, selection, focus and scroll ownership. For a complex app, inventory everything but walk representative tasks through the hierarchy; include a cross-component comparison and an interrupted edit. A route or component inventory is not a requirement to open everything together. Include existing tabs, parallel work contexts and separate mobile shells: decide how they retain identity, drafts and access when mapped to occurrences. Separate three relationships: domain ownership, navigation ancestry and simultaneous work. Related data need not be parent and child; peers with shared selection or synchronized pan/zoom need not become a navigation chain. Distinguish a destination type, the record it shows and each occurrence of it: the same record can appear in independent work contexts while sharing data updates. Bulk selection is a set to act on, not a demand to open one cell per record. Establish cold-start selection from the task; read **Cold start** instead of inventing an arbitrary first item.

Start with familiar UX patterns and explain their task benefit before mapping them to cells and rows. The following examples are an open vocabulary, neither exhaustive nor mutually exclusive: use other patterns, combinations or justified variations when they fit. A recognizable name does not replace an explanation of the behavior needed.

| Pattern example | Relationship to preserve | Possible Supermax expression |
| --- | --- | --- |
| List-detail (master-detail) | Selection with collection context | Collection → item chain |
| Overview + detail | Consult the whole while investigating a part | Overview beside detail, when both fit |
| Supporting pane / inspector | Context belonging to the current work | Contextual child; independent row when its task warrants one |
| Split view | Related surfaces with independent selection and scroll | Stacked rows or neighboring full-height cells |
| Progressive disclosure | Secondary information available on demand | Navigation or reading disclosure; optional context through `ifRoom` |
| Coordinated comparison | Compare peers using shared controls or a common axis | A compound task surface, or independent cells when their navigation is genuinely independent |
| Document workspace | Read sources while producing substantial work | Source context beside a full-height editor |

Compare at least two plausible compositions, including both horizontal and vertical opportunities. Inspect embedded cards, footers, status strips and side panels for independent tasks. A split earns its height through useful simultaneous context and independent selection, scroll or navigation; filters and actions on one surface usually stay with that surface. Consider full-height work beside a split when a row cannot provide useful reading or editing space. Preserve a single chain when splitting adds cost without task benefit.

Recommend one composition and its main trade-off. Show alternatives when an unresolved consequential choice needs discussion; do not make the operator perform the inventory or choose from a catalog. Explain which familiar expectations carry over, what Supermax changes, and what happens when required context no longer fits. A missing capability or loss of simultaneous comparison must be explicit, not hidden behind an attractive diagram. Map each required relationship to native shell behavior, a compound task surface inside a cell, or a capability gap to resolve. A useful component, grid tile or data dependency is not automatically a destination. Use host layout for a cell's own task content; do not invent ancestry to simulate arbitrary nested splits or use content layout to replace the shell's navigation.

### Allocate space and controls

Treat allocation as a task policy, not a collection of attractive pixel values. For each surface, explain what the user must still be able to read, decide or operate when space is scarce, which context may leave view, and the action that recovers it. Required simultaneous evidence must remain usable together; access through Show is sufficient only when alternating actually supports the task. Preserve identity, consequential state, essential actions and draft recovery without keeping every surrounding panel visible. Consider task frequency, interruption cost and whether hidden background activity needs scoped feedback.

Derive bounds from real content at the cell's allocated size, after chrome, rather than from viewport labels:

- **Minimum:** the smallest size at which the task still works, with readable content, usable controls and a viable scroll region. Lowering it just to fit more cells conceals a design failure.
- **Preferred:** a useful working size for the common task and content, not a screenshot's dimensions. Check both typical and dense states.
- **Maximum:** where extra room stops helping this content. Assign elastic growth to work that benefits from it; use the guide's **Widths express content semantics** for exact allocation rules.

Width and height have separate budgets. At narrow widths, reason through the actual ancestor-hiding order, kept content and compact rails, optional `ifRoom` openings, and full-height work beside a split. `keep` must earn its space; keeping everything can force overflow. A compact form must retain meaningful access, and an optional pane must have an explicit opening path when it did not open automatically. Specify what remains open but hidden, rather than describing all disappearance as closure.

For height, validate every split's row minima and chrome against the supported workspace height. Give the elastic row useful growth and verify divider extremes, scrolling and full-height reading/editing. Rows fold by default to trade height; declare `fold: false` for one that must not fold or `fold: { size }` to optionally reserve space (0px by default). Check that each row becomes usable when its cue is clicked. The row window still hides protected rows from the top when they cannot fit. If useful minima do not fit, reconsider the split, use a substantial task beside it or open secondary work on demand. Do not silently reduce the supported range or claim short-window usability from validation alone.

Place controls by scope and frequency using **Cell anatomy** and **Control, modal or cell** below. Keep collection filters at the top of their collection, repeated task actions with the task, and independent choices accessible. The `header` handle mounts a small set of useful utilities; it is not a toolbar checklist. Title bars are optional and suppressed inside rows. Verify actual control placement, long titles and narrow widths instead of adding helper text to explain an ambiguous grouping.

### Show the proposal while building

Before layout implementation, show compact ASCII region maps labeled with task names, row boundaries, navigation direction, active selection, scroll owners and full-height breakouts. Cover wide/narrow widths crossed with short/tall heights at measured or explicitly proposed CSS viewport dimensions. Use the same open state across these maps to isolate allocation; show a separate map when an action changes that state. Annotate what stays visible, compacts, hides while open, opens optionally or closes, and how it is recovered. Update the maps when the proposal changes.

The maps describe one hierarchy. Verify the proposed states against the documented window behavior: `ifRoom` opens on navigation, never resize alone; a compact rail requires kept content; ordinary cells and rows fold by default, `fold: false` excludes a surface, and `fold: { size }` optionally reserves space. Do not implement a sketch through host CSS hiding, responsive reparenting or automatic closing. [Composition exercises](composition-exercises.md) provide optional task probes, not layouts to copy.

## Control, modal or cell

Use the installed application-shell guide's "Controls, modals and task cells" for the complete rule and sources. Decide by task length, frequency, risk, recoverability and need for context, never by an HTML form, field count or existing presentation:

- **Control in place:** direct actions and compact contextual inputs stay where the task happens; feedback is proportional and confirmation is reserved for risk that justifies interrupting. Easily reversible toggles need none.
- **Modal:** a short, bounded, infrequent task that benefits from blocking; use `openModal` with its source `from`.
- **Cell:** substantial editing, steps, drafts, detail or comparison; a task that needs surrounding content must not block it in a modal. Content that needs the full height, such as an attachment listed in a row, is a cell declared `height: "full"` beside the split, not a modal and not a cell squeezed into the row.
- **Disclosure:** extra reading information, without unfolding a new editor between reading content.

Preserve choices, defaults, pending/result feedback, errors and recovery when moving an interaction. The host owns focus entry, return and modal containment; Supermax moves no focus itself.

## The contract per click

1. **Pass the clicked element as `origin`** to each click-driven `navigate`, `sync` and `depart`; for `apply`, put `origin` in the open action, not the options. A replaced cell folds away towards the new click, compared with the click that opened it; without an origin it folds on its far edge. Pass `origin: null` when nothing was clicked (a route change, a keyboard shortcut, a timer).
2. **Pass `from` to `openModal`**: the occurrence the modal belongs to, so a frustum links them. `from: null` for a modal that belongs to no cell.
3. **Know the layout before you open.** A split declares `rows` instead of width; its width follows what is open in its rows. Every destination the page does not embed needs its layout declaration registered first: `navigator.register(await readLayout(response))`, from a `HEAD` the server answers with a `Supermax-Layout` header.
   - Prefetch it when a pointer rests on a link for about 100 ms.
   - Keep one in-flight promise per destination and viewer context; a click waits on that same promise instead of sending a second request.
   - A deep link or reload asks for every layout it needs in one batch, then renders once without motion.
4. **While the layout is on its way, call `depart`**, so the cells the click replaces fold away in their rooms instead of nothing happening. When every declaration is already known, skip `depart` and call `sync` (or `navigate`) at once. When the layout fails, call `cancel()` on the handle `depart` returned. Offer a Retry only for a failure that can pass, a network error or a 5xx; a declaration that `register` refuses (`SupermaxConfigurationError`, for example a `context` that differs from the navigator's) fails the same way every time, so log it as the host bug it is.
5. **One render per click.** Use `sync` when the host owns the destination chain, or `navigate` for an opening from content. With `onIntent`, the host commits that intent through `apply`; do not also sync the same action. Never call `sync`, `navigate` or `render` from a `render` or `zoom` event handler; react to the event without rendering again.

The workspace warns once per kind in the console when a host leaves out an `origin` for a replacement or a departure, a `from` for a modal, or renders from a render handler. Treat such a warning as a bug in the host.

## Choose the implementation feature

### Navigation and available space

- **`sync(destinations, { origin, ifRoom })`**: the host knows the whole chain, for example from its URL. One call per navigation; it keeps what is shared and renders once. After a split the next id names one of its rows and the chain continues inside it, so a cell inside a row that the URL names is synced, not navigated to in a second render.
- **`ifRoom`**: a cell that should open only when the window has room for it, such as a detail pane next to a list. It is an ordered chain; the longest beginning that fits without hiding or compacting a cell in view opens, as automatic cells that a later explicit sync or click promotes, and that a later sync without them in its `ifRoom` closes. It never opens on resize. Cells that only make sense together, such as a conversation's metadata and its messages, go in as one nested list, `ifRoom: [["metadata:1", "messages:1"]]`, so they open whole or not at all.
- **`navigate(destination, { from, origin })`**: a click inside a cell's content that opens something to its right, or beside the split when the destination declares `height: "full"` and the click came from a row, when the host does not keep the chain itself.
- **The `show` event**: cancelable before Show closes cells; prevent it to keep an unsaved form open. It guards Show only: browser history, tab switching and other navigation need the host's own draft protection or persistence. The `up` event names the closed cells in `detail.closed`, with destinations, so the host can record the step in its history.
- **`zoom(occurrence)`**: a cell that should take the width of the cells before it, for a destination declared `zoomable: true`. Draw the toggle in the content's `header`. When a sync replaces the zoomed cell, for example after archiving it, pass `zoom` with the destination that stays zoomed, so the cells before it never flash into view.
- **`height: "full"` on a destination**: content that needs the full height, such as an attachment opened from the attachments row of a conversation. From a cell in a row it opens beside the split instead of inside the row, keeps that cell as its origin (`navigate(destination, { from: rowCell, origin })`), and one such cell stands beside a split at a time. A deep link that ends in it is one `sync` whose destinations run through the split, its row and the row cell to the full-height id, the occurrence's own path; `navigator.next(split)` names the cell beside a split.
- **Peek and a compact rail**: a menu that must stay reachable when space runs out. Declare `keep: true` with `compact: { min }`, and give the rail its icons through the workspace's `compactContent(occurrence, workspace)` option, also when the declaration comes from the server. A menu as an icon rail is what lets a phone show it next to the first content.
- **Folding**: ordinary cells and rows can yield space without disappearing. Declare `fold: false` to exclude an important surface or `fold: { size }` to optionally reserve space (0px by default). Kept surfaces stay full or compact. The default fold reserves 0px. The gutter defaults to 1px and hosts may set `--supermax-gutter: 0px`; the canvas-coloured hatch and outline remain visible on the host background. Only the handle opens the fold. The cue marks where content remains open; clicking it unfolds that surface and folds eligible neighbours that need to yield room. Another cue trades the space back. `foldContent(occurrence, axis, workspace)` customizes the cue, where `axis` is `"horizontal"` or `"vertical"`. This is a layout choice, not navigation history or a modal peek.
- **`layout.chains.get(root).spare`** (from the `render` event or `findChain`): the width a chain leaves unused, for a host that fills free space with something other than a cell.

### Content and identity

- **Content handle `{ element, header?, update?, leave?, dispose? }`**:
  - `header`: the content's own lightweight utilities in the cell's title bar when it has one, otherwise at the start of its body; choose their scope and placement as above;
  - `update`: refresh after every render;
  - `leave()`: stop writing shared state the moment a cell starts to close, because it stays mounted while it folds away;
  - `dispose()`: clean up once it is gone.
- **`header: "title"` on a destination**: the exception, not the rule. A cell has no title bar; declare `header: "title"` only for a cell a viewer cannot place from its content, such as a list of edit names or a cell with one control. A cell inside a split row never draws its own bar, even when it declares `header: "title"`; the split owns the bar above its rows. A strip of thumbnails, a map, a photo, a conversation's messages under the split's own bar need none; a title bar on every cell wastes a line and a glance each. Style the bar's three parts (`-leading` with the Show control, `-text`, `-trailing` with the content's `header` controls) in host CSS; never hide or add `.supermax-cell-title` itself.
- **Titles**: a cell's title names the content the cell shows, such as the vault's name, a conversation's subject or "3 open todos", never its role in the structure, such as "Viewer", "Detail" or "List". The host supplies it; declare it with the content's name, and use `setTitle(occurrence, title)` when that name or a count is known or changes after the cell opened.

### Feedback and presentation

- **`openModal`**: the modal in "Control, modal or cell" above, opened with `from` set to the cell it is about.
- **`notify`**: feedback with a scope: `scope: "cell"` with a `source` for something a cell did, `scope: "workspace"` for the whole app.
- **`TimeScale`**: one scale for every millisecond. Pass one `time` to every workspace, scale the host's own waits with `time.ms(milliseconds)`, and write the host's own CSS durations with `time.paint(element, { times, easings, prefix })`.

## What a host never does

- **Call internal methods** such as `navigator.fits`, `openIfRoom`, `openDefaults` or the strip's methods. Use the documented route (`sync` with `ifRoom`); if none exists, ask for one in Supermax instead of reaching inside.
- **Build its own modal structure**, or move controls into `.supermax-*` elements after mount. Use `openModal` and the content's `header`.
- **Label a source next to the frustum** ("From …"). The frustum shows it, and the dialog describes it to assistive technology.
- **Animate cells, rooms, rows or the strip itself**, with CSS transitions or Web Animations on `.supermax-cell`, `.supermax-room`, `.supermax-row` or `.supermax-strip`. Motion belongs to the presentation; a host that needs different motion supplies a `presentation`, such as `VEIL_PRESENTATION` when its cells are large enough that origami's fold moves a screen of content.
- **Rely on `position: fixed` inside cell content.** Cells and the strip carry transforms, so a fixed element positions against them, not the viewport. Move a popover to `document.body` or into the overlay root.
- **Repeat a signature in its own docs or instruction files.** Point at the package docs above, so an upgrade cannot leave a stale copy behind.

## Integrate an existing application

When upgrading existing Supermax contracts, use the target package's migration guide for the implementation sequence. Preserve the product's task coverage as well as its geometry:

- Bind each mounted cell to its own destination and occurrence context, not a global current route that changes underneath it. Carry framework providers, stores and event cleanup into independently mounted roots. Separate shared record updates from local selection, scroll and drafts; restore those deliberately across workspace/tab switches. A navigation snapshot does not store application data.
- Identify actions that create, start, submit or otherwise mutate work. Mounting, prefetching, optional opening and history restoration must not accidentally repeat them. The same click can mean navigation or an in-place action depending on the current mode; preserve that distinction.
- Plan required declarations, initial selection, optional groups and zoom before the navigation commit. Late data must not cause a second automatic navigation for the same intent. Cancel superseded departures and disregard stale results; an optional load failure must not strand required work. Update loaded titles and content without rebuilding the workspace or replaying navigation.
- Keep server and embedded/offline declarations consistent with the same source. Verify the installed package and the served JS/CSS or standalone output; a local dependency can be a snapshot. Rebuilding a source checkout alone does not update consumers.

Walk one complete task through entry, work, interruption and recovery, then cover the remaining routes and control outcomes. Do not weaken an existing required guard to fit a primitive: verify the current modal and navigation limits before replacing it. Fix integration through public contracts rather than copying internal shell behavior.

## Verify the adaptation in use

Measure the viewport and workspace after application chrome. Inspect the render with realistic long labels, dense/empty/error content and active drafts at the proposed dimensions and where content ceases to fit. Run the guide's **Adaptation checklist** interaction checks: deep links, reload, browser history, Show, hidden rows, selection continuity and control scope. Test optional openings and full-height work from their actual origins. At each size, actually finish the task with the proposed minimums: inspect hidden essential controls, lost comparison context, excessive scrolling and unreachable recovery. Try repeated records in separate contexts, coordinated peers, bulk selection and mode-dependent actions where the product has them; these are probes of responsibility, not a required screen catalog.

Exercise keyboard reading order, accessible names, focus entry/return, visible focus, usable targets and browser/text zoom. The host owns focus. Hiding, Show and closing are different transitions: check scroll, selection and drafts through each. Short height must leave the active task and recovery usable; optional context must remain discoverable. Protect expert density, stable positions and direct access during repeated use.

Report expected versus observed allocation and behavior, fix mismatches, and refresh the maps and captures. A diagram, passing allocator test or model review is not evidence of a usable rendered application. If the runtime is unavailable, deliver a clearly labeled proposal with its unresolved checks.
