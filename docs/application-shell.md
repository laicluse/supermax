# Supermax application shell

Supermax is an application shell, not merely a responsive column allocator. New content opens below and then to the right, like reading a book: a cell can split into rows, every row runs its own left-to-right chain, and one Back closes what was opened last. The allocator decides which cells fit and how wide they become; the navigator decides what is open and what Back closes; the host owns content and should follow this contract so that navigation, controls, and content remain predictable across applications.

## Vocabulary

- **Destination:** a cell definition the host registers: title, `min` and `max` width in pixels, optionally a default child or rows, and host data.
- **Occurrence:** one opened destination at one place, identified by the path of destination ids from the root.
- **Chain:** a row of cells from a root cell to the right; the workspace root is a chain and every row is a chain.
- **Split:** a cell whose rows are chains stacked below each other.
- **Row tab:** the form of a collapsed row: its title on one line, which opens the row again.
- **Group:** what one Back closes: a manual opening together with every default it brought along, named after its root cell.
- **Default:** a cell that opened by itself because its parent names it as `defaultChild` and the row had room; a click on it promotes it into a group of its own.
- **Compact cell:** a cell shown as a narrow rail because the chain lacks room or the user collapsed it; its content shows in a peek.
- **Peek:** the overlay beside a rail that holds the compact cell's own content.
- **Hint:** the title and bounds an action carries so an unknown destination can open as a provisional cell before its definition loads.
- **Reveal:** the view window of a chain whose cells do not all fit; a chip names the nearest hidden cell and moves the window.
- **Notice:** temporary feedback with a scope, placed in its source cell or in the workspace region.
- **Presentation:** the motion and surface treatment of cells, replaceable without changing behaviour.

## Start with the cell path

Write the complete product hierarchy before writing layout code, for example:

```text
workspace -> collection -> item -> task -> subdetail
```

Each level is one cell with one data owner and one responsibility. Opening a child adds information to the right while preserving its ancestors on the left for as long as they fit. A modal, drawer, accordion, or page redirect is usually a sign that a true child has not been modeled as a cell.

A cell whose children are independent of each other splits into rows instead of a chain:

```text
albums -> album
            |- thumbnails -> photo -> metadata
            |- map        -> photo -> metadata
            `- people     -> photo -> metadata
```

Each row keeps its own selection and its own left-to-right chain. The same photo opened from two rows is two occurrences with separate local state. The hierarchy says where a cell belongs; the order of openings says what Back closes.

The ordered list of manual openings is the source of truth for what is open. A deep link replays that list, browser back returns to the previous list, and the viewport decides only how much of it is visible and which defaults opened automatically. The allocator may hide ancestors; it does not close them.

## Cell anatomy

A cell has three regions. Only the body is required, but their order is stable:

```text
┌ header: back | identity | cell-scoped controls ┐
│ body: the cell's single scroll owner            │
├ optional contextual or batch bar                ┤
└ optional task toolbar                           ┘
```

- **Header/navigation bar:** orientation and controls that affect the entire cell. Put collection creation, search, sort, filter, view, and cell zoom here. In the V2 workspace the shell draws the cell header (title and reveal control) and the Back control lives in the workspace navigation bar; host content starts below the header.
- **Body:** content and selection. A collection row has one primary interaction: select it. Row-level button farms duplicate the detail cell and make the hierarchy ambiguous.
- **Context bar:** temporary state that qualifies the body, such as a batch selection summary. It appears only while that state exists.
- **Task toolbar:** the stable action set for the current item or task. Use it for repeated decisions, commit/cancel actions, and destructive actions that operate on the body above. Its visual association must be with this cell, never with a neighboring cell or all rows at once.

Place a control by scope, not by available space:

| Control affects | Placement |
| --- | --- |
| Application or workspace | Root cell header |
| Entire collection | Collection header |
| One collection row | Select the row; expose actions in its child detail cell |
| Current item identity or lightweight utility | Detail header |
| Current item decision or mutation | Detail task toolbar |
| Form draft | Form toolbar or form footer |
| Temporary multi-selection | Context bar in the owning collection cell |
| Child resource | A new cell to the right |

Creation is navigation as well as an action: a collection-level **New** control belongs in the collection header and opens an editor cell to the right. It does not replace the collection, open an unrelated page, or appear as another list row.

## Widths express content semantics

`min` is the smallest width at which a cell remains useful. `max` is the widest width at which more space still improves that content. Neither value describes a target viewport or a page-wide container. The allocator combines the bounds; the host must not add a global maximum width around the chain. The allocator itself is unit-free: a host may measure in columns, the workspace measures in pixels.

Use these as starting ranges in pixels, then verify against real content:

| Cell archetype | Typical `min` | Typical `max` | Reason |
| --- | ---: | ---: | --- |
| Mode or compact navigation | 200 | 260 | Short labels and counts |
| Collection or list | 200 | 360 | Scannable rows should stay compact |
| Editor or compact form | 320 | 520 | Labels and fields need a readable measure |
| Detail or document | 320 | 720 | Prose and metadata can use more room |
| Media or working surface | 480 | 1200 | Visual comparison benefits from width |
| Canvas or world | 480 | 1600 | May consume remaining space; often zoomable |

Do not copy these numbers mechanically. A dense data table may need more width than a list; a short inspector may need less than a document. If every cell receives the same bounds, the information architecture has not been expressed in the layout.

## Collection and detail behavior

- Keep the collection cell as the parent while its selected item opens to the right.
- Mark the selected row, but do not make it a second action surface.
- Put item-specific actions in the detail or task cell.
- Let filters and route context inherit to the right.
- Open create and edit flows as child cells when they are part of the hierarchy.
- Use one scroll owner per cell. Headers and task toolbars remain stable while the body scrolls.

When cells no longer fit, hide ancestors from the left. Do not squeeze them into narrow columns and do not add horizontal page scrolling. The first visible header provides a reveal control for the rightmost hidden ancestor; revealing changes what is visible, never what is open. When the first visible cell of a chain is a split, which has no header of its own, that control sits in the navigation bar next to Back. Selecting new content returns focus to the rightmost active cells.

## Rows

A split spans the full width of its own cell and stacks its rows from top to bottom. Rows never share column boundaries with each other, and no cell spans more than one row. Rows are owned by their split: they open with it, close with it, and cannot be replaced or promoted on their own. A split opens from the workspace's root chain and its rows are plain cells; a split inside a row is refused. Inside a row the horizontal rules above apply unchanged: ancestors hide from the left, the newest cell survives, and the first visible cell's header carries a reveal control for the rightmost hidden ancestor. Revealing is a view change, not navigation: it never opens, closes, or regroups anything, and the next opening in that row or above it resets the view to its newest cells.

Rows declare `minHeight` and `maxHeight`. When the split is too short for every row, rows give way from the top: they shrink to their minimum first and then collapse to a row tab, while the focused row (the row holding the focused occurrence, or the last row) always stays open, at its minimum height if need be. A row tab is compact presentation, not a closed row; activating it focuses that row and lets rows above or below it collapse instead. Keyboard focus follows the same rule: focusing content in a row makes that row the protected one, and when a cell slides out of view the focus moves to the visible cell of the same row. Collapse, resize, focus, and reveal preserve drafts, scroll positions, and every navigation group.

### Compact cells and peek

A destination may declare `compact: { min, content? }`: a narrow form the cell can take instead of hiding. When a chain does not fit, cells with a compact form go compact from the left, at most `maxCompact` per chain (default 2) so a long chain never fills the viewport with rails; only then do cells hide. The first cell of an application, the menu, is the typical compact cell: give it icons through `compact.content` so it stays usable at a glance. A user can collapse any cell except the last one from its header, and expand it again from the `Expand` control in its peek; a collapse is view state, never a group, and user collapses count before automatic ones. When the first visible cell of a chain is compact, the reveal chip for the cells hidden to its left floats over the chain instead of sitting in a hidden header.

A compact cell shows a peek on hover, on keyboard focus and on tap: an overlay beside the rail that holds the cell's own content, so a draft typed in a peek is the same draft in the cell. Enter or Space on the rail, and ArrowRight while the peek is open, move keyboard focus into the peek; a mouse click on the rail keeps the peek open, a second tap on a touch screen closes it. The peek closes on Escape, with its own close control, when focus leaves it, when a navigation starts from inside it, and when the pointer leaves it while nothing inside it holds the keyboard focus, so typing in a peek is never cut short by the mouse. A peek never writes history and never changes a group; a navigation from a peek is an ordinary opening. Peek and collapse stay local to one workspace, a navigation from a peek reaches every workspace that follows the same intents.

### Preferred sizes and dividers

A cell may declare `preferred` between `min` and `max`, and a row `preferredHeight`. When a chain has room for every minimum but not for every maximum, cells get their preferred size at an exact fit; at a shortage each cell gets its minimum plus a share of the remaining budget proportional to its own preferred minus minimum; at a surplus each cell gets its preferred size plus a share of the surplus proportional to its maximum minus preferred. The rule is the same in both directions and in any order of cells; a cell without a preference prefers its maximum. Two cells of min 200 and max 600 with preferences 280 and 500 therefore split 600px as 242 and 358, 780px as 280 and 500, and 1000px as 448 and 552.

Every boundary between two full cells, and between two open rows, is a divider: a hairline with an 8px hit area and a resize cursor. Dragging it, or moving it with the arrow keys (16px per step, Home and End for the bounds) while it has focus, sets a session size for the cell on its left or the row above it, clamped between that cell's minimum and the largest size that leaves the other visible cells their minimums; a reached bound simply stops. A cell's width and a row's height are separate session sizes, also for the first cell of a row. A session size is exact as long as the other cells keep their minimums beside it; when the frame shrinks below that it turns into a preference, so the sized cell gives up width with the others instead of pushing them out, and it is exact again as soon as there is room. It wins over the app preference until the divider's reset control, or Backspace on the divider, removes it; it survives resizes and content updates and closes with its cell. The zoom anchor and compact cells use the same allocation; a session size never makes a cell hide. The demo's frame handle is the browser's own resize control and never binds to cell sizes.

### Loading layout: hints, provisional cells and late defaults

An application rarely knows every destination up front. A link may therefore open a destination the navigator has not seen, as long as the action carries a `hint`: `{ title, min?, max?, preferred?, defaultChild? }`. The navigator registers a provisional definition from the hint (a generic 200 to 320px cell when the hint names only a title; sizes that are not positive numbers fall back to the generic cell, an empty title falls back to the id), opens the occurrence in its group, and the shell shows a loading placeholder with the hinted title and size. A refused opening registers nothing, and an action without a hint for an unknown id is refused as `unknown-destination`. Deep links keep the hint in the action (`o:<id>@<from>?title=…&min=…`), so a reload replays the same opening before any request returns.

`define(id, definition)` completes a provisional destination in place: the occurrence keeps its id, position and group, the title updates everywhere it shows, the bounds take the real values, a compact form gets its rail, and the definition's `defaultChild` opens now if the row has room. A definition with `rows` is validated like an opening; a refused split closes the cell it was meant to complete and reports `{ ok: false, reason: "invalid-rows", validation }` through the `rejected` event, a valid one opens its rows in place. `define` also serves parents that are still waiting: a cell whose `defaultChild` was unknown when it opened remembers that, and opens the default the moment its definition arrives, in the group that opened the parent. The waiting ends as soon as anything opens under that parent, so a default the user replaced or closed with Back never returns, and a definition that merely arrives again (a prefetch, a refetch after a viewer switch) opens nothing. Default chains stop where a destination would repeat inside its own chain, so a cyclic default cannot run away. `navigator.missingDefinitions()` lists the ids a host still has to fetch (provisional cells in use and awaited defaults); `workspace.failDefinition(id, error, retry)` shows the error with a Retry in every provisional cell of that destination and stops parents from waiting for it; `navigator.forget(id)` drops a definition that no open cell uses.

Content loads through the same `content` callback: return a promise of `{ element, update?, dispose? }` and the cell shows `Loading <title>` until it settles. A rejected promise, or a thrown callback, shows `<title> could not load.` with the error text and a Retry control that calls the callback again. Navigation never waits for content: a failed cell is still an open cell, and Back closes it. Every mount has a generation, so an answer for an unmounted or remounted cell is discarded and its handle disposed. `workspace.reload(predicate)` runs the callback again for every open cell the predicate accepts, and for the open modal; a host that switches viewer context reloads its remote cells that way, forgets the definitions it no longer shows and refetches the rest, as the demo does for Ana and Ben.

The demo answers layout definitions and content from the album catalog inside the page, with the viewer, a delay and a failure switch as controls, so it also runs as a static site.

### A modal with an origin

`workspace.openModal({ title, content }, { from })` opens one dialog above the cells. The header carries the title and `From <source title>`; the dialog sits anchored just inside its source cell when that cell is visible and full, otherwise centred. `content(modal, workspace)` follows the cell contract, including a promise with the loading and error states, so delayed modal content shows `Loading <title>` and a Retry; content that arrives late does not take focus away from a notice the user moved to. The cells behind the modal are inert, Tab and Shift+Tab cycle through the dialog and the workspace notices, Escape, the close control, the backdrop and `workspace.closeModal(reason)` close it. The navigation bar stays clickable and readable by assistive technology: the shared Back closes the modal and navigates nothing, and any navigation intent closes the modal before it runs. A second `openModal` replaces the open modal; there are no nested modals. A modal writes no history and is local to one workspace.

Closing returns focus in this order: the row tab when the source sits in a collapsed row, the control that opened the modal when the source cell is still visible, otherwise the source cell itself (its rail when compact), otherwise the focused cell or the root, and finally the Back button. When the source closes while the modal is open (a Back from another workspace, for example) the header says `Its source has closed` and the modal stays until the user closes it. The `modal` event reports `open` and `closed` with the reason and the source.

### Notices with a scope

`workspace.notify({ id?, scope, source?, sourceTitle?, kind, message, action?, duration? })` shows temporary feedback. `scope: "cell"` places the notice inside its source cell, under the cell title, as long as that cell is visible, full and in an open row; otherwise, and for `scope: "workspace"`, the notice appears in the workspace region at the bottom right, prefixed with the source title and a `Show <source>` control that opens the row, reveals the cell and focuses it. The `Show` control appears only while the source is open but out of view. A notice whose source is not open says so and offers no way back, because a closed cell is never reopened by a late response; `sourceTitle` lets the host name a source the workspace never had. Notices move between the two homes on every render, so collapsing a row carries its cell notices into the workspace region and opening it carries them back; while a modal is open every cell notice lives in the workspace region, where the keyboard can reach it, and it returns when the modal closes. `workspace.dismissAll()` clears them, which a host does when it resets or replays a workspace.

`kind` sets the duration and tone: `success` expires after 4s (or `duration` ms), paused while hovered or focused; `error` has `role="alert"` and stays until dismissed or acted on; `action` carries `action: { label, run }` and stays until acted on or dismissed. The same `id` never shows twice in one workspace, so a duplicated response produces one notice; ids therefore identify events, not kinds of event, and a host that wants a fresh notice for a repeated action gives it a fresh id and dismisses the earlier one. A notice never takes focus. Its dismiss control is reachable by Tab, also from inside a modal, and Escape inside a notice dismisses only that notice; focus then returns to the modal, the source cell or the next notice. The workspace region is `aria-live="polite"`. A cell whose content failed to load shows its own Retry and raises no notice; that is the host's call. The `notice` event reports `shown`, `dismissed`, `expired` and `acted`.

### Presentation is one override point

The workspace moves cells with one presentation: the default `SLIDE_PRESENTATION` slides a chain with `CellStrip`, new cells entering from the right, closed cells leaving the same way, with the same 200ms timeline for widths and strip movement. Peeks, modals and notices carry their own small entrance; loading cells show a mark. `new Workspace(element, { presentation })` or `workspace.setPresentation(presentation)` replaces that treatment with `{ name, motion?, createStrip? }`. `motion` is `{ enter(element, timing), leave(element, timing) }`: the strip calls `enter` for a cell that appears and `leave` for a cell on its way out, with the strip's own duration and easing, and the Web Animations the hooks return join the strip's timeline, so an interrupted entrance is cancelled with the rest and `finished` waits for it; the strip clears an inline `transform-origin` afterwards. A presentation that needs more than motion supplies `createStrip(viewport, workspace)` returning an object with the `CellStrip` contract: `update(entries, { animate })` places the entries, keeps a departing entry mounted and marked with `data-supermax-exiting` until `finished` resolves, makes hidden entries inert, and `destroy()` removes it. The workspace carries `supermax-presentation-<name>` on its element so a stylesheet can restyle surfaces, peeks and modals for that presentation; row heights move on the strip's timeline. Switching rebuilds the strips without animation and changes no state, no groups, no geometry and no focus; the `presentation` event names the new presentation.

Behaviour stays with the workspace, not with the presentation: an override cannot change what opens, closes or receives focus, and reduced motion still paints every update immediately. The demo's second presentation, `fold`, uses `motion` only: a rotation on entering and leaving cells, with cell surfaces and the modal restyled through that class.

### Minimum height is validated up front

The application declares the smallest viewport height it supports. Before a split opens, every row is checked: the navigation bar, one row tab per other row (the ancestor chrome budget, bounded by the maximum number of rows per split), and the row's own `minHeight` must fit inside that height. An exact fit passes; one pixel over fails; an empty split, a split with more rows than allowed, a row that is itself a split, two rows with the same destination, and a row or cell whose minimum exceeds its maximum fail. The check runs for a split the user opens and for a split that would open as a default; a default that fails stays closed and becomes a manual choice that reports the same verdict. The result names the row, the required height, the chrome budget, and the supported height, and a refused open touches nothing already open. Those numbers are for the developer; the content that offered the link shows an understandable message and a way on.

![The Lab album refused with its reason under the frame](assets/captures/lab-rejected.png)

Below the supported height the shell keeps the focused row at its minimum and lets the workspace scroll. That is the emergency behaviour for a window the application never promised to support, distinct from an invalid configuration inside the supported range.

## Navigation groups and Back

A manual opening forms a navigation group. Every default that this opening triggers while the row has room belongs to the same group, across any number of levels: opening an album that auto-opens a photo that auto-opens its metadata is one group, and one Back closes all of it. Groups close in reverse order of opening across all rows: after opening photos A, B and C in three rows, Back closes C, then B, then A; after A, C, B it closes B, then C, then A. The selectors remain, and groups opened earlier are untouched.

A default opens only when the row has room: the sum of the minimum widths of the row's cells plus the candidate must fit the row's width at the moment of opening. Otherwise the default stays visible as a manual choice, and opening it later forms its own group. A wide and a narrow viewport therefore reach the same content through a different number of groups, and the Back history records what actually happened in that viewport.

Two rules cover the cases the three-row example leaves open:

- **Replacing content on the same slot.** Opening Photo B where Photo A was open closes Photo A and everything under it; its group disappears. Back on Photo B returns to the selector. Supermax does not restore the replaced content; that would be an undo system.
- **An explicit click on content that is already open automatically.** The occurrence and the defaults under it move into a new group with that occurrence as root, so the next Back closes exactly what the user just chose. The defaults that moved along stay automatic, so a later click on one of them promotes it in turn. Without this rule, Back after clicking visible metadata would close the whole album, which contradicts what the user did last. Clicking content that was already opened manually changes nothing.

Hiding, resizing, focusing a row, and revealing an ancestor never create or rewrite groups. The Back control names the content it will close, also when that content lives in another row than the focus or is hidden; the title shows the focused content with its ancestors as context. When nothing is left to close, Back is disabled and says so.

### Deep links and browser history

The library ships no router: the host owns the log of actions and how it travels. The demo shows one shape. Its URL carries the ordered log of applied manual actions, including Backs; an action every frame refused stays out. A fresh navigation to such a link replays the log from the start, and every viewport computes its own defaults while replaying, so the result depends on the size each viewport has at that moment, because room is decided when something opens and a resize never rewrites what is open. Within a session each action pushes a history entry that also stores a snapshot of what every frame has open, so browser back, forward and reload restore that earlier state instead of replaying; content that stayed open through such a step keeps its drafts, content that closed was disposed and comes back fresh. The snapshot holds what is open, the groups, the focused occurrence and the reveal windows as they were when the action was taken; a focus or reveal change on its own writes no history entry. An action whose source is no longer open in a viewport is rejected there and reported; the demo never invents hidden steps to make the viewports match.

## Cold start

A Supermax application should open into useful work, not a landing page that duplicates the first collection.

1. Restore a valid explicit selection from the route or durable session state.
2. Otherwise select the first item from the product's meaningful ordering, such as the most recent active item.
3. Open its stable default task when that relationship is unambiguous.
4. Stop at the first task that needs human judgment.
5. Preserve the collection cell between the workspace and selected item, even when selection was automatic.

A manual opening is offered to every viewport. Automatic defaults depend on room, so a narrow viewport may stop one level earlier and offer that default as a manual choice, and a viewport where the source of a later opening never appeared rejects that opening.

## Adaptation checklist

Before implementing a Supermax adaptation:

1. Draw every reachable route as a cell tree, including create, edit, empty, error, and external-leaf states.
2. Inventory every existing control and assign its scope: application, collection, selection, item, task, form, or child resource.
3. Classify each cell by content and set independent `min` and `max` bounds; give each row `minHeight` and `maxHeight`.
4. Specify each cell's header controls, scroll owner, context bar, and task toolbar.
5. Define the cold-start selection and the defaults that may open automatically when there is room.
6. Declare the minimum supported viewport height and check every split against it.
7. Define narrow behavior: which ancestors hide, which rows collapse first, and what the Back control names.
8. Import the workspace stylesheet and give the workspace element a height; theme it through the `--supermax-*` custom properties.
9. Only then wire the navigator and render the cells.

Verify the result with real content at narrow and wide sizes, preferably side by side. Test deep links, reload, browser back, group-wise Back across rows, selected-row continuity, hidden-ancestor recovery, collapsed rows, drafts surviving a collapse, create/edit child cells, and every control's scope. A green allocator test does not verify the application shell.

## Common failures

- Treating Supermax as a set of responsive cards inside a centered page container.
- Designing desktop and phone page variants instead of one route-driven cell stack.
- Navigating from collection to detail as separate pages and losing sibling context.
- Hiding collections or help text inside accordions instead of modeling hierarchy and disclosure deliberately.
- Putting **New**, search, or sort below a collection when they govern the whole collection.
- Putting item mutations on every row instead of in the selected item's child cell.
- Mixing identity, explanation, and repeated task actions in one verbose body block.
- Choosing cell widths to fill one screenshot rather than to suit the information carrier.
