# Supermax application shell

Supermax is an application shell, not merely a responsive column allocator. New content opens below and then to the right, like reading a book: a cell can split into rows, every row runs its own left-to-right chain, and the screen is a window on that reading order that one Show control moves toward its beginning. The allocator decides which cells fit and how wide they become; the navigator decides what is open; the host owns content and should follow this contract so that navigation, controls, and content remain predictable across applications.

## Vocabulary

- **Destination:** a cell definition the host registers: title, `min` and `max` width in pixels, optionally a default child or rows, and host data.
- **Occurrence:** one opened destination at one place, identified by the path of destination ids from the root.
- **Chain:** a row of cells from a root cell to the right; the workspace root is a chain and every row is a chain.
- **Split:** a cell whose rows are chains stacked below each other.
- **Group:** a manual opening together with every default it brought along, named after its root cell; `navigator.closeNewestGroup()` closes the newest one.
- **Default:** a cell that opened by itself because its parent names it as `defaultChild` and the row had room; a click on it promotes it into a group of its own.
- **Kept cell:** a destination or row the host marks `keep: true`; it stays in view while the cells or rows around it hide, if need be in a compact form the host supplies.
- **Peek:** the overlay beside a kept cell's rail that holds its own content.
- **Hint:** the title and bounds an action carries so an unknown destination can open as a provisional cell before its definition loads.
- **Window:** the part of the reading order that is in view. It ends at the newest content until Show, or a click on content that is already open, moves its start.
- **Notice:** temporary feedback at the top of the viewport, linked to the cell it came from when that cell is in view.
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

- **Header/navigation bar:** orientation and controls that affect the entire cell. Put collection creation, search, sort, filter, view, and cell zoom here. In the V2 workspace the shell draws the cell header (title and reveal control) and the Show control lives in the workspace navigation bar; host content starts below the header.
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

When cells no longer fit, hide ancestors from the left, entirely. Do not squeeze them into narrow columns and do not add horizontal page scrolling. The Show control in the navigation bar brings them back one at a time; changing what is visible never changes what is open. Selecting new content brings its destination into view and focuses it.

## Rows

A split spans the full width of its own cell and stacks its rows from top to bottom. Rows never share column boundaries with each other, and no cell spans more than one row. Rows are owned by their split: they open with it, close with it, and cannot be replaced or promoted on their own. A split opens from the workspace's root chain and its rows are plain cells; a split inside a row is refused. Inside a row the horizontal rules above apply unchanged: ancestors hide from the left and the newest cell survives.

Rows declare `minHeight` and `maxHeight`. When the split is too short for every row, rows give way from the top: they shrink to their minimum first and then hide entirely, the same way cells hide from the left. There are no row tabs. Hiding, resizing and moving the window preserve drafts, scroll positions and every navigation group, and keyboard focus that sat in hidden content moves to the nearest visible cell.

### The window and Show

Content has one reading order: a chain from left to right, and at a split each row top to bottom, each row's chain from left to right. The screen is a window on that order, and by default it ends at the newest content.

The Show control, `requestUp()` in code, gives access to everything the window hides. Supermax only ever hides cells that lie higher in the hierarchy than what is in view: to the left in a chain, or in a row above. Show brings one of them back, names it (`‹ Thumbnails`) and focuses it. Which one follows the order in which content appeared, because siblings have no priority of their own. The branch the user opened last climbs first: from its deepest open cell upward, the first cell above the window is the target. When that branch has nothing hidden above the window, the branch opened before it is next, and so on. Content that opened by itself appeared top-down, so its rows climb bottom-up; a deep link replays its actions in order, so Show climbs its hierarchy in the order of the link. Opening History A in the Map row and then in the Thumbnails row hides Map and then Thumbnails; the first Show brings Thumbnails back, the second Map. A cell the window left behind to the right or below is never a target; clicking the content that opened it is the way there. The control says what the user wants to see; Supermax works out what has to go for it. In a chain it closes cells from the end, deepest first, until the shown cell fits, and no more than that: one cell, or several small ones when the shown cell needs a lot of room. Clicking the content that opened them brings them back. Rows cannot close on their own, so when a row comes back above, the lowest row falls out of view instead. When nothing is hidden above the window the control is not there at all. The control shows only the chevron, the familiar mark of going up a level, and the title of the cell it brings back; its accessible name is `Show <title>`, which contains the visible words as speech control needs. Supermax keeps its own chrome to that minimum and leaves the rest to the host. With a modal open, Show closes the modal before it shows, like any navigation.

The window has an anchor per chain and per split. Show, a click on content that is already open, and a notice's Show move the anchor just far enough to bring their target into view. More room shows as much as fits, toward the end first; less room hides from the end, so the anchor stays in view. Without an anchor the window ends at the newest content, and a new opening clears the anchors of every chain and split above it. The window and what the control closes are local to one workspace and stay out of a shared action log; a host that keeps a browser history records each step there, so browser back returns to the moment before, as the demo does.

The focus is the cell the user works in. Clicking or tabbing into a cell, opening content, and Show set it; when the focused cell leaves the view, focus moves to the nearest cell still in view, and when that is a split it lands on the first cell of its top visible row. The keyboard follows that focus. A definition that arrives for the focused cell brings it into view.

### Kept cells and peek

Nothing becomes a narrow rail or a tab by default. A host marks a destination, or a row in a split's `rows`, with `keep: true` when it must stay in view, for example a menu that switches between modes of the application; the cells around it hide while it stays. A kept destination may also declare `compact: { min, content? }`, a narrow form it takes when the chain lacks room; give it icons through `compact.content` so it stays usable at a glance. A `compact` form without `keep` is never used. A kept cell or row stays in every window, also when Show has moved the window to earlier content; it only leaves the view when its whole container does, for example a kept cell in a row that hid, and then Show reaches it like any other cell. Cells folded away between a kept cell and the window take no room at all. When the kept cells and the newest cell still exceed the width, the newest cell keeps its minimum and the workspace scrolls horizontally, the same emergency a row gets below the supported height.

A compact kept cell shows a peek on hover, on keyboard focus and on tap: an overlay beside the rail that holds the cell's own content. Enter or Space on the rail, and ArrowRight while the peek is open, move keyboard focus into the peek; a mouse click on the rail keeps the peek open, a second tap on a touch screen closes it. The peek closes on Escape, with its own close control, when focus leaves it, when a navigation starts from inside it, and when the pointer leaves it while nothing inside it holds the keyboard focus. A peek never writes history and never changes a group; a navigation from a peek is an ordinary opening.

### Preferred sizes and dividers

A cell may declare `preferred` between `min` and `max`, and a row `preferredHeight`. When a chain has room for every minimum but not for every maximum, cells get their preferred size at an exact fit; at a shortage each cell gets its minimum plus a share of the remaining budget proportional to its own preferred minus minimum; at a surplus each cell gets its preferred size plus a share of the surplus proportional to its maximum minus preferred. The rule is the same in both directions and in any order of cells; a cell without a preference prefers its maximum. Two cells of min 200 and max 600 with preferences 280 and 500 therefore split 600px as 242 and 358, 780px as 280 and 500, and 1000px as 448 and 552.

Every boundary between two full cells, and between two open rows, is a divider: a hairline with an 8px hit area and a resize cursor. Dragging it, or moving it with the arrow keys (16px per step, Home and End for the bounds) while it has focus, sets a session size for the cell on its left or the row above it, clamped between that cell's minimum and the largest size that leaves the other visible cells their minimums; a reached bound simply stops. A cell's width and a row's height are separate session sizes, also for the first cell of a row. A session size is exact as long as the other cells keep their minimums beside it; when the frame shrinks below that it turns into a preference, so the sized cell gives up width with the others instead of pushing them out, and it is exact again as soon as there is room. It wins over the app preference until the divider's reset control, or Backspace on the divider, removes it; it survives resizes and content updates and closes with its cell. The zoom anchor and compact cells use the same allocation; a session size never makes a cell hide. The demo's frame handle is the browser's own resize control and never binds to cell sizes.

### Loading layout: hints, provisional cells and late defaults

An application rarely knows every destination up front. A link may therefore open a destination the navigator has not seen, as long as the action carries a `hint`: `{ title, min?, max?, preferred?, defaultChild? }`. The navigator registers a provisional definition from the hint (a generic 200 to 320px cell when the hint names only a title; sizes that are not positive numbers fall back to the generic cell, an empty title falls back to the id), opens the occurrence in its group, and the shell shows a loading placeholder with the hinted title and size. A refused opening registers nothing, and an action without a hint for an unknown id is refused as `unknown-destination`. Deep links keep the hint in the action (`o:<id>@<from>?title=…&min=…`), so a reload replays the same opening before any request returns.

`define(id, definition)` completes a provisional destination in place: the occurrence keeps its id, position and group, the title updates everywhere it shows, the bounds take the real values, a compact form gets its rail, and the definition's `defaultChild` opens now if the row has room. A definition with `rows` is validated like an opening; a refused split closes the cell it was meant to complete and reports `{ ok: false, reason: "invalid-rows", validation }` through the `rejected` event, a valid one opens its rows in place. `define` also serves parents that are still waiting: a cell whose `defaultChild` was unknown when it opened remembers that, and opens the default the moment its definition arrives, in the group that opened the parent. The waiting ends as soon as anything opens under that parent, so a default the user replaced or closed never returns, and a definition that merely arrives again (a prefetch, a refetch after a viewer switch) opens nothing. Default chains stop where a destination would repeat inside its own chain, so a cyclic default cannot run away. `navigator.missingDefinitions()` lists the ids a host still has to fetch (provisional cells in use and awaited defaults); `workspace.failDefinition(id, error, retry)` shows the error with a Retry in every provisional cell of that destination and stops parents from waiting for it; `navigator.forget(id)` drops a definition that no open cell uses.

Content loads through the same `content` callback: return a promise of `{ element, update?, dispose? }` and the cell shows `Loading <title>` until it settles. A rejected promise, or a thrown callback, shows `<title> could not load.` with the error text and a Retry control that calls the callback again. Navigation never waits for content: a failed cell is still an open cell, and choosing another branch closes it. Every mount has a generation, so an answer for an unmounted or remounted cell is discarded and its handle disposed. `workspace.reload(predicate)` runs the callback again for every open cell the predicate accepts, and for the open modal; a host that switches viewer context reloads its remote cells that way, forgets the definitions it no longer shows and refetches the rest, as the demo does for Ana and Ben.

The demo answers layout definitions and content from the album catalog inside the page, with the viewer, a delay and a failure switch as controls, so it also runs as a static site.

### A modal with an origin

`workspace.openModal({ title, content }, { from })` opens one dialog front and centre in the viewport, above a backdrop. The header carries the title and `From <source title>` and moves the dialog by pointer; the corner grip resizes it. The definition bounds it with the names cells and rows use: `min`, `max` and `preferred` for its width (defaults 280, 720 and 440 pixels), `minHeight`, `maxHeight` and `preferredHeight` for its height (defaults 160, the viewport, and the height of its content); moving and resizing never take it past the viewport inset. `content(modal, workspace)` follows the cell contract, including a promise with the loading and error states, so delayed modal content shows `Loading <title>` and a Retry; content that arrives late does not take focus away from a notice the user moved to. The cells behind the modal are inert, Tab and Shift+Tab cycle through the dialog and the notices, Escape, the close control, the backdrop and `workspace.closeModal(reason)` close it. A second `openModal` replaces the open modal; there are no nested modals. A modal writes no history and is local to one workspace.

Closing returns focus in this order: the control that opened the modal when the source cell is still visible, otherwise the source cell itself (its rail when compact), otherwise the focused cell or the root. When the source closes while the modal is open (a group closed from another workspace, for example) the header says `Its source has closed` and the modal stays until the user closes it. The `modal` event reports `open` and `closed` with the reason and the source.

### Notices with a scope

`workspace.notify({ id?, scope, source?, sourceTitle?, kind, message, action?, duration? })` shows temporary feedback, and carries its source on `data-source`. A notice whose source cell is in view appears as a bubble inside that cell, centred under its title with an arrow pointing at it, so it needs no name; several bubbles for one cell stack under the first. A notice whose source is out of view, hidden behind a modal, or absent goes to the stack at the top of the viewport, centred, sliding in from the top edge and leaving the same way; there it is prefixed with the source title, and while the source is open a `Show <source>` control brings it into view and focuses it. A notice whose source is not open says so and offers no way back, because a closed cell is never reopened by a late response; `sourceTitle` lets the host name a source the workspace never had. `workspace.dismissAll()` clears the notices together with the memory of shown ids, which a host does when it resets or replays a workspace.

`kind` sets the duration and tone: `success` expires after 4s (or `duration` ms), paused while hovered or focused; `error` has `role="alert"` and stays until dismissed or acted on; `action` carries `action: { label, run }` and stays until acted on or dismissed. The same `id` never shows twice in one workspace, so a duplicated response produces one notice; ids therefore identify events, not kinds of event, and a host that wants a fresh notice for a repeated action gives it a fresh id and dismisses the earlier one. A notice never takes focus. Its dismiss control is reachable by Tab, also from inside a modal, and Escape inside a notice dismisses only that notice; focus then returns to the modal, the source cell or the next notice. The notice stack is `aria-live="polite"`. A cell whose content failed to load shows its own Retry and raises no notice; that is the host's call. The `notice` event reports `shown`, `dismissed`, `expired` and `acted`.

### Overlays and their origin

Notices and the modal treat the browser viewport as their viewport by default. `overlayRoot` names another element that plays that part, for example a frame that emulates a device; give that element `contain: layout` (or a transform) so fixed positioning resolves inside it, and the workspace mounts its notices there, one stack per root. Each notice carries its dismiss control in its top right corner. Placement is CSS with defaults: `--supermax-overlay-inset` (16px) is the distance to the viewport edge, `--supermax-notice-width` (440px) and `--supermax-modal-width` (440px) cap their widths, and `--supermax-backdrop` colours the layer behind a modal.

When a modal or a notice comes from a cell that is in view, Supermax links the two with a frustum: the four side faces between the overlay's corners and the cell's corners, in transparent black with light from above (`--supermax-origin-top`, `-left`, `-right`, `-bottom`), only the faces turned towards the viewer, and a hairline around the source (`--supermax-origin-edge`). From a modal it runs across the backdrop to the source. A bubble sits inside its source cell, so its faces fill the cell around it and the cell reads as recessed, which also dims what the bubble covers. A notice in the top stack has left its source and gets no link; a veil behind the stack dims the viewport from its top, left and right edges down to just below the last notice (`--supermax-notice-veil`). Links grow from the overlay to the source while they fade in, the veil slides down while it fades in, and the modal's backdrop fades in; reduced motion shows them at once. `new Workspace(element, { origin })` replaces the drawing: a function `origin({ kind, layer, links })` receives the SVG layer to draw into, `kind` (`modal` or `notice`) and a list of `{ id, from, to }` rectangles in that layer's coordinates; `frustumOrigin` is the default and `origin: null` draws nothing.

Notices carry their kind in a faint tint, a deeper border and an ink for the icon and buttons: `--supermax-notice-success-surface`, `-border` and `-ink`, and the same for `error` and `action`. The icon is a line glyph per kind from `defaultNoticeIcon`; `noticeIcon: (kind, document, notice) => element` supplies another and `noticeIcon: null` shows none.

### Words are the host's to replace

Supermax writes as few words as it can: the control's chevron and title, Loading and Retry in a cell, the source line of a modal and a notice, and accessible names. Every one of them comes from `strings`, English by default. A host passes `new Workspace(element, { strings })` with only the entries it replaces, each a function of the title or message it needs, so a language can choose its own word order; `DEFAULT_STRINGS` lists the keys. An unknown key or a value that is not a function throws when the workspace is created. Messages from a `SupermaxConfigurationError` are for developers and stay English.

### Presentation is one override point

The workspace moves cells with one presentation: the default `SLIDE_PRESENTATION` slides a chain with `CellStrip`, new cells entering from the right, closed cells leaving the same way, with the same 200ms timeline for widths and strip movement. Peeks, modals and notices carry their own small entrance; loading cells show a mark. `new Workspace(element, { presentation })` or `workspace.setPresentation(presentation)` replaces that treatment with `{ name, motion?, createStrip? }`. `motion` is `{ enter(element, timing), leave(element, timing) }`: the strip calls `enter` for a cell that appears and `leave` for a cell on its way out, with the strip's own duration and easing, and the Web Animations the hooks return join the strip's timeline, so an interrupted entrance is cancelled with the rest and `finished` waits for it; the strip clears an inline `transform-origin` afterwards. A presentation that needs more than motion supplies `createStrip(viewport, workspace)` returning an object with the `CellStrip` contract: `update(entries, { animate })` places the entries, keeps a departing entry mounted and marked with `data-supermax-exiting` until `finished` resolves, makes hidden entries inert, and `destroy()` removes it. The workspace carries `supermax-presentation-<name>` on its element so a stylesheet can restyle surfaces, peeks and modals for that presentation; row heights move on the strip's timeline. Switching rebuilds the strips without animation and changes no state, no groups, no geometry and no focus; the `presentation` event names the new presentation.

Behaviour stays with the workspace, not with the presentation: an override cannot change what opens, closes or receives focus, and reduced motion still paints every update immediately. The demo's second presentation, `fold`, uses `motion` only: a rotation on entering and leaving cells, with cell surfaces and the modal restyled through that class.

### Minimum height is validated up front

The application declares the smallest viewport height it supports. Every split must fit inside it: the navigation bar and each row's own `minHeight`, with at most the maximum number of rows. An exact fit passes; one pixel over fails; an empty split, a split with more rows than allowed, a row that is itself a split, two rows with the same destination, and a row or cell whose minimum exceeds its maximum fail.

An impossible split is a mistake in the application's configuration, never something to show its users. The `Navigator` therefore checks every split it is given when it is created and throws a `SupermaxConfigurationError` that names the split, the row, the problems and the heights, so the mistake surfaces on the first run in development or in a test. `validateDestinations(destinations, { minViewportHeight, chrome })` runs the same check without creating a navigator, for a test suite or a build step. Definitions that arrive later, through `define()` or as a split under a hint, get the same check before they open; a refused one opens nothing, keeps what was open, and reaches the developer as a `rejected` event with the verdict, not as text in the interface.

Below the supported height the shell keeps the first row of the window at its minimum and lets the workspace scroll. That is the emergency behaviour for a window the application never promised to support, distinct from an invalid configuration inside the supported range.

## Navigation groups

A manual opening forms a navigation group. Every default that this opening triggers while the row has room belongs to the same group, across any number of levels: opening an album that auto-opens a photo that auto-opens its metadata is one group. `navigator.closeNewestGroup()` closes the newest group, all of it, in reverse order of opening across all rows: after opening photos A, B and C in three rows it closes C, then B, then A; after A, C, B it closes B, then C, then A. The selectors remain, and groups opened earlier are untouched. In the interface content closes when the user chooses another branch, or when the Show control needs room for a parent.

A default opens only when the row has room: the sum of the minimum widths of the row's cells plus the candidate must fit the row's width at the moment of opening. Otherwise the default stays visible as a manual choice, and opening it later forms its own group. A wide and a narrow viewport therefore reach the same content through a different number of groups, and the groups record what actually happened in that viewport.

Two rules cover the cases the three-row example leaves open:

- **Replacing content on the same slot.** Opening Photo B where Photo A was open closes Photo A and everything under it; its group disappears. Closing Photo B's group returns to the selector. Supermax does not restore the replaced content; that would be an undo system.
- **An explicit click on content that is already open automatically.** The occurrence and the defaults under it move into a new group with that occurrence as root, so closing the newest group closes exactly what the user just chose. The defaults that moved along stay automatic, so a later click on one of them promotes it in turn. Without this rule, closing after clicking visible metadata would close the whole album, which contradicts what the user did last. Clicking content that was already opened manually changes nothing.

Hiding, resizing, focusing and moving the window never create or rewrite groups. The title names where the application is: the root of the newest group that is in view, with its ancestors as links. A focus change or a resize leaves it where it is; after the Show control closed Depth 20 to show Depth 15, the title reads Depth 19, the deepest cell still open, and never names a cell that has gone.

### Deep links and browser history

The library ships no router: the host owns the log of actions and how it travels. The demo shows one shape. Its URL carries the ordered log of applied manual actions; an action every frame refused stays out, and Show, which only moves a frame's window, never enters it. A fresh navigation to such a link replays the log from the start, and every viewport computes its own defaults while replaying, so the result depends on the size each viewport has at that moment, because room is decided when something opens and a resize never rewrites what is open. Within a session each action pushes a history entry that also stores a snapshot of what every frame has open, so browser back, forward and reload restore that earlier state instead of replaying; content that stayed open through such a step keeps its drafts, content that closed was disposed and comes back fresh. The snapshot holds what is open, the groups, the focused occurrence and the windows as they were when the action was taken; a focus or window change on its own writes no history entry. A click in one viewport reaches the other as the same new click: the other viewport opens whatever on the clicked path it lacks, for example cells its own up control closed, and when the click opened something new where the other viewport still had it open with deeper cells, that viewport opens it anew too. Each viewport then opens its own defaults for its own size. The up control is the exception and stays in its own viewport, because what it shows and closes depends on the size.

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
7. Define narrow behavior: which cells or rows the host keeps, and what Show brings back first.
8. Import the workspace stylesheet and give the workspace element a height; theme it through the `--supermax-*` custom properties.
9. Only then wire the navigator and render the cells.

Verify the result with real content at narrow and wide sizes, preferably side by side. Test deep links, reload, browser back, Show across cells and rows, selected-row continuity, hidden rows, drafts surviving while their cell is hidden, create/edit child cells, and every control's scope. A green allocator test does not verify the application shell.

## Common failures

- Treating Supermax as a set of responsive cards inside a centered page container.
- Designing desktop and phone page variants instead of one route-driven cell stack.
- Navigating from collection to detail as separate pages and losing sibling context.
- Hiding collections or help text inside accordions instead of modeling hierarchy and disclosure deliberately.
- Putting **New**, search, or sort below a collection when they govern the whole collection.
- Putting item mutations on every row instead of in the selected item's child cell.
- Mixing identity, explanation, and repeated task actions in one verbose body block.
- Choosing cell widths to fill one screenshot rather than to suit the information carrier.
