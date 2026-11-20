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
- **Layout declaration:** what a server says about a destination before its content exists: title, bounds, rows and default child, with the whole chain of defaults it brings along.
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

`min` is the smallest width at which a cell remains useful. `max` is the widest width at which more space still improves that content. Neither value describes a target viewport or a page-wide container. The allocator combines the bounds; the host must not add a global maximum width around the chain. Every layout names one elastic cell for its width and, in a split, one elastic row for its height: a destination with `max: "*"` and a `preferred` width, a row with `maxHeight: "*"` and a `preferredHeight`. The elastic cell is the one that may grow without limit and decides itself what its content does with the room, which HTML handles well. It shares space like any other cell, with its preference as its max, and once every other visible cell has reached its `max` it takes whatever is left; when several elastic cells are in view, the newest one does. The lint refuses a configuration without an elastic destination, a split without exactly one elastic row, and an elastic cell or row without a preference, in `validateDestinations` and in `register()`. When no elastic cell is in view, for example while only a menu is open, the canvas shows beside the cells, and the navigator's `spareSpace` option aligns them: `"start"` (the default), `"center"` or `"end"`.

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

When cells no longer fit, hide ancestors from the left, entirely. Do not squeeze them into narrow columns and do not add horizontal page scrolling. The Show control in the navigation bar brings them back one at a time; changing what is visible never changes what is open. Selecting new content brings its destination into view.

## Rows

A split spans the full width of its own cell and stacks its rows from top to bottom. Rows never share column boundaries with each other, and no cell spans more than one row. Rows are owned by their split: they open with it, close with it, and cannot be replaced or promoted on their own. A split opens from the workspace's root chain and its rows are plain cells; a split inside a row is refused. Inside a row the horizontal rules above apply unchanged: ancestors hide from the left and the newest cell survives.

Rows declare `minHeight` and `maxHeight`. When the split is too short for every row, rows give way from the top: they shrink to their minimum first and then hide entirely, the same way cells hide from the left. There are no row tabs. Hiding, resizing and moving the window preserve drafts, scroll positions and every navigation group.

### The window and Show

Content has one reading order: a chain from left to right, and at a split each row top to bottom, each row's chain from left to right. The screen is a window on that order, and by default it ends at the newest content.

The Show control, `requestUp()` in code, gives access to everything the window hides. Supermax only ever hides cells that lie higher in the hierarchy than what is in view: to the left in a chain, or in a row above. Show brings one of them back and names it (`‹ Thumbnails`). Which one follows the order in which content appeared, because siblings have no priority of their own. The branch the user opened last climbs first: from its deepest open cell upward, the first cell above the window is the target. When that branch has nothing hidden above the window, the branch opened before it is next, and so on. Content that opened by itself appeared top-down, so its rows climb bottom-up; a deep link replays its actions in order, so Show climbs its hierarchy in the order of the link. Opening History A in the Map row and then in the Thumbnails row hides Map and then Thumbnails; the first Show brings Thumbnails back, the second Map. A cell the window left behind to the right or below is never a target; clicking the content that opened it is the way there. The control says what the user wants to see; Supermax works out what has to go for it. In a chain it closes cells from the end, deepest first, until the shown cell fits, and no more than that: one cell, or several small ones when the shown cell needs a lot of room. Clicking the content that opened them brings them back. Rows cannot close on their own, so when a row comes back above, the lowest row falls out of view instead. When nothing is hidden above the window the control is not there at all. The control shows only the chevron, the familiar mark of going up a level, and the title of the cell it brings back; its accessible name is `Show <title>`, which contains the visible words as speech control needs. Supermax keeps its own chrome to that minimum and leaves the rest to the host. With a modal open, Show closes the modal before it shows, like any navigation.

The window has an anchor per chain and per split. Show, a click on content that is already open, and a notice's Show move the anchor just far enough to bring their target into view. More room shows as much as fits, toward the end first; less room hides from the end, so the anchor stays in view. Without an anchor the window ends at the newest content, and a new opening clears the anchors of every chain and split above it. The window and what the control closes are local to one workspace and stay out of a shared action log; a host that keeps a browser history records each step there, so browser back returns to the moment before, as the demo does.

### Kept cells and peek

Nothing becomes a narrow rail or a tab by default. A host marks a destination, or a row in a split's `rows`, with `keep: true` when it must stay in view, for example a menu that switches between modes of the application; the cells around it hide while it stays. A kept destination may also declare `compact: { min, content? }`, a narrow form it takes when the chain lacks room; give it icons through `compact.content` so it stays usable at a glance. A `compact` form without `keep` is never used. A kept cell or row stays in every window, also when Show has moved the window to earlier content; it only leaves the view when its whole container does, for example a kept cell in a row that hid, and then Show reaches it like any other cell. Cells folded away between a kept cell and the window take no room at all. When the kept cells and the newest cell still exceed the width, the newest cell keeps its minimum and the workspace scrolls horizontally, the same emergency a row gets below the supported height.

A compact kept cell shows a peek on hover and on a click or tap: an overlay beside the rail that holds the cell's own content. A click on the rail keeps the peek open, a second tap on a touch screen closes it. The peek closes with its own close control, when a navigation starts from inside it, and when the pointer leaves it. A peek never writes history and never changes a group; a navigation from a peek is an ordinary opening.

### Preferred sizes and dividers

A cell may declare `preferred` between `min` and `max`, and a row `preferredHeight`. When a chain has room for every minimum but not for every maximum, cells get their preferred size at an exact fit; at a shortage each cell gets its minimum plus a share of the remaining budget proportional to its own preferred minus minimum; at a surplus each cell gets its preferred size plus a share of the surplus proportional to its maximum minus preferred. The rule is the same in both directions and in any order of cells; a cell without a preference prefers its maximum. Two cells of min 200 and max 600 with preferences 280 and 500 therefore split 600px as 242 and 358, 780px as 280 and 500, and 1000px as 448 and 552.

Every boundary between two full cells, and between two open rows, is a divider: a hairline with an 8px hit area and a resize cursor. Dragging it sets a session size for the cell on its left or the row above it, clamped between that cell's minimum and the largest size that leaves the other visible cells their minimums; a reached bound simply stops. A cell's width and a row's height are separate session sizes, also for the first cell of a row. A session size is exact as long as the other cells keep their minimums beside it; when the frame shrinks below that it turns into a preference, so the sized cell gives up width with the others instead of pushing them out, and it is exact again as soon as there is room. It wins over the app preference until the divider's reset control removes it; it survives resizes and content updates and closes with its cell. Compact cells use the same allocation; a session size never makes a cell hide. The demo's frame handle is the browser's own resize control and never binds to cell sizes.

### Loading layout: declarations before the first pixel

A cell opens only once its layout is known, so its room, its rows and the defaults that open with it are final from the first frame; content may load later inside that shape, layout never arrives late. The page embeds the declarations it needs to show itself, as the navigator's `destinations`. For everything else the server answers a request, usually a `HEAD` the host sends when a pointer rests on a link for about 100ms, with a `Supermax-Layout` header:

```http
Supermax-Layout: v=1; hash="sha256-…"; inline="<base64url of the canonical JSON set>"
ETag: "sha256-…"
Cache-Control: private, no-cache
```

The header carries a declaration set: `{ schemaVersion: 1, context, root, destinations }`, where `destinations` holds the root and every destination its defaults and rows reach, each as `{ title, min, max, preferred, defaultChild, keep?, compact?: { min }, rows? }` with `preferred` and `defaultChild` written out, also when they are `null`. A large set is served as an immutable snapshot instead, named by `url="…"` in place of `inline`. The server derives the set, the header and the content from one declaration per destination and viewer context, so they cannot disagree. `encodeLayoutHeader(set)` writes the header value, `readLayout(response)` reads a response back, fetches a snapshot when the header names one, and refuses a header without a set, with an unknown schema or with bytes that do not match the hash, as a `SupermaxLayoutError`.

`navigator.register(set)` adds the declarations and opens nothing. It refuses the whole set with a `SupermaxConfigurationError` before anything is registered when a declaration is malformed or carries other fields than layout, when a default or row names a destination the set does not carry, when defaults form a cycle, when a split cannot fit the supported height, when the set is for another `context` than the navigator's, or when a destination that is already known is declared differently. A difference between what was drawn and what the server says is therefore a configuration error in development and a refused opening in production, never a cell that moves. `open()` takes no layout of its own: an action that carries a `hint` throws a `TypeError`, and an undeclared destination is refused as `unknown-destination`.

The host opens a destination after its declaration is registered. A click that comes before the prefetch shows at once on its control that it waits, asks for the layout, and opens in one navigation and one render, with every default that fits; a click, Back or any other action in the meantime cancels that opening. When the layout cannot be had, nothing opens and no Back step appears; the failure says which destination it was and offers Retry. Deep links name only destination and source (`o:<id>@<from>`): a reload asks for every layout the link needs in one batch and renders the whole state once, without motion. Content requests name the layout they were opened with (`layoutHashOf(definition)`), so the server renders under that layout or refuses, and a viewer switch is a new context that loads the page again. Default chains stop where a destination would repeat inside its own chain.

While a layout is on its way, the content it replaces can leave without waiting for it. `workspace.depart(occurrence, { after, origin })` folds the occurrence and everything opened from it away after `after` milliseconds (`TIMING.depart`, 50ms), each cell in its own room and over the same edge a replacement from `origin` would use. The rooms stay reserved and show the canvas. The next render ends the departure. When it comes within `after`, nothing has folded yet and it is one ordinary transition; when it comes later, the new cells open in the reserved rooms once the old ones are gone. A departed cell that the render keeps folds back from where it is, and so does every departed cell when the host calls `cancel()` on the handle `depart` returns, for instance because the layout failed. A new `depart` brings back what it no longer covers. A host that already holds every declaration skips `depart` and renders at once. The demo departs the cells a click replaces while it asks for the layout, and its Delay control (`?delay=`) shows that wait.

Content loads through the same `content` callback: return a promise of `{ element, header?, update?, leave?, dispose? }` and the cell shows `Loading <title>` until it settles. A rejected promise, or a thrown callback, shows `<title> could not load.` with the error text and a Retry control that calls the callback again. Navigation never waits for content: a failed cell is still an open cell, and choosing another branch closes it. Every mount has a generation, so an answer for an unmounted or remounted cell is discarded and its handle disposed. `workspace.reload(predicate)` runs the callback again for every open cell the predicate accepts, and for the open modal.

The demo answers layout and content from the album catalog inside the page, with real `Response` objects and headers, a viewer, a delay and a failure switch as controls, so it also runs as a static site.

### A modal with an origin

`workspace.openModal({ title, content }, { from })` opens one dialog front and centre in the viewport, above a backdrop. The header carries the title and moves the dialog by pointer; the frustum shows where the modal comes from, and the dialog describes its source to assistive technology as `From <source title>` (`aria-description`, `strings.modalFrom`); the corner grip resizes it. The definition bounds it with the names cells and rows use: `min`, `max` and `preferred` for its width (defaults 280, 720 and 440 pixels), `minHeight`, `maxHeight` and `preferredHeight` for its height (defaults 160, the viewport, and the height of its content); moving and resizing never take it past the viewport inset. Without `preferredHeight` a modal whose content loads late opens at its minimum height and grows when the content arrives; a host that knows how tall that content will be declares it, as a destination declares its layout, so the modal opens at its final size. `content(modal, workspace)` follows the cell contract, including a promise with the loading and error states, so delayed modal content shows `Loading <title>` and a Retry. The cells behind the modal are inert, and the close control, the backdrop and `workspace.closeModal(reason)` close it. A second `openModal` replaces the open modal; there are no nested modals. A modal writes no history and is local to one workspace.

When the source closes while the modal is open (a group closed from another workspace, for example) its frustum disappears, the dialog describes itself as `Its source has closed` (`strings.modalSourceClosed`), and the modal stays until the user closes it. The `modal` event reports `open` and `closed` with the reason and the source.

### Notices with a scope

`workspace.notify({ id?, scope, source?, sourceTitle?, kind, message, action?, duration? })` shows temporary feedback, and carries its source on `data-source`. A notice whose source cell is in view appears as a bubble inside that cell, centred under its title with an arrow pointing at it, so it needs no name; several bubbles for one cell stack under the first. A notice whose source is out of view, hidden behind a modal, or absent goes to the stack at the top of the viewport, centred, sliding in from the top edge and leaving the same way; there it is prefixed with the source title, and while the source is open a `Show <source>` control brings it into view. A notice whose source is not open says so and offers no way back, because a closed cell is never reopened by a late response; `sourceTitle` lets the host name a source the workspace never had. `workspace.dismissAll()` clears the notices together with the memory of shown ids, which a host does when it resets or replays a workspace.

`kind` sets the duration and tone: `success` expires after 4s (or `duration` ms), paused while hovered; `error` has `role="alert"` and stays until dismissed or acted on; `action` carries `action: { label, run }` and stays until acted on or dismissed. The same `id` never shows twice in one workspace, so a duplicated response produces one notice; ids therefore identify events, not kinds of event, and a host that wants a fresh notice for a repeated action gives it a fresh id and dismisses the earlier one.  The notice stack is `aria-live="polite"`. A cell whose content failed to load shows its own Retry and raises no notice; that is the host's call. The `notice` event reports `shown`, `dismissed`, `expired` and `acted`.

### Overlays and their origin

Notices and the modal treat the browser viewport as their viewport by default. `overlayRoot` names another element that plays that part, for example a frame that emulates a device; give that element `contain: layout` (or a transform) so fixed positioning resolves inside it, and the workspace mounts its notices there, one stack per root. Each notice carries its dismiss control in its top right corner. Placement is CSS with defaults: `--supermax-overlay-inset` (16px) is the distance to the viewport edge, `--supermax-notice-width` (440px) and `--supermax-modal-width` (440px) cap their widths, and `--supermax-backdrop` colours the layer behind a modal.

When a modal or a notice comes from a cell that is in view, Supermax links the two with a frustum: the four side faces between the overlay's corners and the cell's corners, in transparent black with light from above, and in dark mode in transparent white so they still read lighter towards the top (`--supermax-origin-top`, `-left`, `-right`, `-bottom`), only the faces turned towards the viewer. Each face fades from the overlay's edge towards the source, in bands parallel to that edge: its opacity runs from half of `--supermax-origin-fade` (0.1) above its own colour's to half below it, never below zero. `--supermax-origin-edge` draws a line around the source; it is transparent by default. From a modal it runs across the backdrop to the source. A bubble sits inside its source cell, so its faces fill the cell around it and the cell reads as recessed, which also dims what the bubble covers. A notice in the top stack has left its source and gets no link; a veil behind the stack dims the viewport from its top, left and right edges down to just below the last notice (`--supermax-notice-veil`). Everything that appears in Supermax eases out and everything that disappears eases in. A modal grows out of its source: in 200ms with ease-out, the timeline of a new cell, a plane the size of the source cell moves and scales to the modal's place while the whole dialog fades in as one, and the link follows the plane. Closing reverses it in 200ms with ease-in: the dialog shrinks back into its source while it fades out, the link follows it and the backdrop fades out. The workspace takes input at once; the leaving dialog is inert and marked with `data-supermax-exiting` until it is gone. A notice's link grows from the bubble to the source while it fades in, the veil slides down while it fades in, and the modal's backdrop fades in; reduced motion shows them at once, and a modal without a source in view keeps a short fade. `new Workspace(element, { origin })` replaces the drawing: a function `origin({ kind, layer, links, entering, time })` receives the SVG layer to draw into, `kind` (`modal` or `notice`), a list of `{ id, from, to }` rectangles in that layer's coordinates and, while a modal grows out of its source or shrinks back into it, `entering` as how far the dialog has come out, from 0 to 1 (otherwise `null`), and `time`, the workspace's `TimeScale` for any growth of its own; the workspace calls it every frame of the entrance and the exit; `frustumOrigin` is the default and `origin: null` draws nothing.

Notices carry their kind in a faint tint and an ink for the icon and buttons: `--supermax-notice-success-surface` and `-ink`, and the same for `error` and `action`. The icon is a line glyph per kind from `defaultNoticeIcon`; `noticeIcon: (kind, document, notice) => element` supplies another and `noticeIcon: null` shows none.

### Words are the host's to replace

Supermax writes as few words as it can: the control's chevron and title, Loading and Retry in a cell, the source line of a modal and a notice, and accessible names. Every one of them comes from `strings`, English by default. A host passes `new Workspace(element, { strings })` with only the entries it replaces, each a function of the title or message it needs, so a language can choose its own word order; `DEFAULT_STRINGS` lists the keys. An unknown key or a value that is not a function throws when the workspace is created. Messages from a `SupermaxConfigurationError` are for developers and stay English.

### The default look

The stylesheet draws flat rectangles without outlines. Cells stand apart by a gutter of one width, `--supermax-gutter` (1px): every visible cell after the first in a chain, every open row after the first and the navbar carry one gutter towards their neighbour, so two cells never add up to two. Through the gutter you see the canvas, the application's own background (`--supermax-canvas`): black in light mode, light grey in dark mode. `--supermax-radius` is 0, so a host that wants rounded controls sets it.

Every surface and ink colour is a `light-dark()` pair on `:root`, inside `:where()` so any host rule wins: canvas, surface, raised surface, muted surface, ink, muted ink, accent, warning, backdrop, shadow, the notice veil and the notice tints. Whether they switch follows the host's `color-scheme`: a host without `color-scheme: light dark` stays light. Supermax manages no keyboard focus and handles no keys of its own; focus styling is the host's.

### Presentation is one override point

The workspace moves cells with one presentation, and the default `ORIGAMI_PRESENTATION` folds them. One click gives every cell it touches one transition. Opening takes one 200ms stroke with ease-out: the cell folds out from the edge it shares with its parent (its left edge in a chain, its top edge as the first cell of a row), and every default that opens with it folds out at the same moment. Closing without a replacement is that stroke played backwards: the cell folds back onto the edge it opened from, its ease-out running as an ease-in, while its neighbours move back the way they came; clicking back and forth reverses the same motion from wherever it is. A replacement from rest takes two strokes: the old cells, its defaults included, fold away in place while their room stays, then the room takes its new size and the new cells fold open in it. Every cell is a finished card: while it opens, closes, replaces another or only changes size, it keeps the larger of its old and new size, and only its room in the chain opens, closes or changes; once everything is still it takes its new size. Its content therefore lays out once, never while it moves. A card that stays but changes size moves as a whole with its edge: its own edge sits on its room's edge in every frame, so it is never cut off there, and what leaves its room disappears under its neighbour; a row that changes height does the same with its bottom edge. Neighbours that move together share that edge: the room of a folding cell is as wide as the cell's projection in every frame, and a row whose first cell folds is as tall as that projection, so papers stay joined at their edges across and down, never overlap and never leave canvas between them; a split that opens or closes is as wide as its rows. A paper that stays and only changes size moves its edge on the same 200ms timeline. Each card folds inside a room of its own (`.supermax-room`), which clips it to its rectangle, and every room gets the shared vanishing point as its own `perspective-origin`. A gutter is the left edge of a frame that does not move: a cell's room, or for the gutter beside a split, the frame of each of its rows. That edge clips whatever folds or slides inside, so the perspective never draws a card over a gutter and a row's cells never cover the split's gutter while they slide. A cell that hides or comes back for lack of room, or turns compact, only moves. The cell stays opaque while it folds and shades as one towards the canvas colour (`--supermax-canvas`, through the opacity of a layer over the whole cell, which the compositor animates without touching the cell's content), so it matches the canvas exactly while it stands on edge and overlapping cells cover each other instead of showing through; content that arrives later swaps in without a fade of its own. A split does not fold itself; the cells in its rows fold in the same stroke. Nothing moves on load: the first render, a reload, a deep link and a replay show their state at once, while `restore(snapshot, { animate: true })`, which the demo uses for browser back and forward, moves like any other transition, and so do a resize, a dragged divider, a presentation switch and reduced motion, which also end every motion that runs.

A transition can be interrupted at any moment, and every cell continues from where it is instead of restarting. A cell that is still folding open when a replacement takes its place tears off: from its current pose it flies to the folded pose on its far edge while it shades into the canvas. A cell that is folding away when it is wanted again, after Back or a click on it, folds back open from its current pose, as the same element with its drafts. A new cell on a place that is already in motion folds open at once while the earlier layers tear off, so clicking faster than a stroke shows each superseded cell leaving on its own path; there is no limit to how many layers a place holds. Widths, the strip's offset and row heights always move from their drawn value to the newest target.

Rooms move once the renders have settled. An animated render sets every target at once, but rooms, the strip's offset and row heights start to move only when no further render follows within the settle window (`STRIP_TIMING.settle`, 20ms). A render inside the window moves the targets, and every room then goes in one motion from its drawn size to the newest target: only the net change moves, never a shrink followed by a growth. A close that the next render takes back moves nothing, and a close followed by an opening at the same place is one replacement. A target that moves less than `STILL` (2px) is taken without motion. The window holds only from rest; a place that is already in motion follows a new target at once. Content does not wait for rooms: a replaced cell folds away at once inside its room, and a new cell opens when its room starts to move. Load, reduced motion and the immediate updates (a resize, a dragged divider, a presentation switch) have no window. Measured on the demo and on a mail client built on Supermax, every click, Back, Show and zoom renders once, so the window has nothing to merge there; it lasts a little over one frame, to catch renders of one input that land in the next frame. The smallest target changes a redistribution of spare space makes are 0.9 to 1.6px, the next ones 3px and more, hence `STILL`. `TIMING.depart` lies above the time most layouts take: in that mail client the render after a layout request falls 12 to 46ms after the click, and its server answers 90% of layout requests within 41ms.

Every duration Supermax keeps lives in `TIMING` (`@laicluse/supermax`), in milliseconds: the stroke, the settle window, a departure's wait, a peek's open and close delay, a notice's entrance, exit and life, the frustum's growth, the loading mark and the divider highlight. One `TimeScale` multiplies all of them, for Web Animations, timers and the stylesheet alike: the workspace writes every scaled duration and easing onto its element and its notice layer as custom properties (`--supermax-time-stroke`, `--supermax-ease-appear`, …), which `workspace.css` reads. `new Workspace(element, { time })` takes a shared `TimeScale`, so several workspaces slow down together, and `workspace.setTimeScale(n)` or `time.set(n)` changes it for every motion and wait that starts afterwards. A host scales its own waits with `time.ms(milliseconds)`, and `time.paint(element, { times, easings, prefix })` writes its own durations as custom properties the same way. The demo's Speed control sets one scale for both frames, its network delay, its hover prefetch and its waiting pulse.

Every chain viewport shares one vanishing point per overlay root, centred horizontally and at the golden section of its height from the top (`HORIZON`, 0.382); `--supermax-perspective` sets the depth. Peeks, modals and notices carry their own small entrance; loading cells show a mark. `new Workspace(element, { presentation })` or `workspace.setPresentation(presentation)` replaces the treatment with `{ name, motion?, createStrip? }`. `motion` is `{ open(element, { axis }), close(element, { axis }) }`, each returning the folded pose `{ origin, transform, shade? }` a cell opens from or closes to, `shade` being how far it is shaded towards the canvas in that pose (1 by default), with `axis` `"row"` for the first cell of a row and `"chain"` otherwise; the strip builds every stroke, tear and return from those two poses, with its own timing. A presentation without `motion` moves cells by width and position only. A presentation that needs more supplies `createStrip(viewport, workspace)` returning an object with the `CellStrip` contract: `update(entries, { animate, arrive })` places the entries, keeps a departing entry mounted and marked with `data-supermax-exiting` until it has gone, makes hidden entries inert, and `destroy()` removes it. It may also offer `depart(ids, { after, toward })` and `stay(ids)`; without them `workspace.depart` leaves the content where it is. The workspace carries `supermax-presentation-<name>` on its element so a stylesheet can restyle surfaces, peeks and modals for that presentation. Switching rebuilds the strips without animation and changes no state, no groups and no geometry; the `presentation` event names the new presentation.

Behaviour stays with the workspace, not with the presentation: an override cannot change what opens or closes, and reduced motion still paints every update immediately. The demo also offers `fold`, which supplies `motion` only: a shallower rotation on its left edge for both poses, with cell surfaces and the modal restyled through that class.

### Minimum height is validated up front

The application declares the smallest viewport height it supports. Every split must fit inside it: the navigation bar and each row's own `minHeight`, with at most the maximum number of rows. An exact fit passes; one pixel over fails; an empty split, a split with more rows than allowed, a row that is itself a split, two rows with the same destination, and a row or cell whose minimum exceeds its maximum fail.

An impossible split is a mistake in the application's configuration, never something to show its users. The `Navigator` therefore checks every split it is given when it is created and throws a `SupermaxConfigurationError` that names the split, the row, the problems and the heights, so the mistake surfaces on the first run in development or in a test. `validateDestinations(destinations, { minViewportHeight, chrome })` runs the same check without creating a navigator, for a test suite or a build step. Declarations registered later through `navigator.register()` get the same check, and a refused set registers nothing.

Below the supported height the shell keeps the first row of the window at its minimum and lets the workspace scroll. That is the emergency behaviour for a window the application never promised to support, distinct from an invalid configuration inside the supported range.

## Navigation groups

A manual opening forms a navigation group. Every default that this opening triggers while the row has room belongs to the same group, across any number of levels: opening an album that auto-opens a photo that auto-opens its metadata is one group. `navigator.closeNewestGroup()` closes the newest group, all of it, in reverse order of opening across all rows: after opening photos A, B and C in three rows it closes C, then B, then A; after A, C, B it closes B, then C, then A. The selectors remain, and groups opened earlier are untouched. In the interface content closes when the user chooses another branch, or when the Show control needs room for a parent.

A default opens only when the row has room: the sum of the minimum widths of the row's cells plus the candidate must fit the row's width at the moment of opening. Otherwise the default stays visible as a manual choice, and opening it later forms its own group. A wide and a narrow viewport therefore reach the same content through a different number of groups, and the groups record what actually happened in that viewport.

Two rules cover the cases the three-row example leaves open:

- **Replacing content on the same slot.** Opening Photo B where Photo A was open closes Photo A and everything under it; its group disappears. Closing Photo B's group returns to the selector. Supermax does not restore the replaced content; that would be an undo system.
- **An explicit click on content that is already open automatically.** The occurrence and the defaults under it move into a new group with that occurrence as root, so closing the newest group closes exactly what the user just chose. The defaults that moved along stay automatic, so a later click on one of them promotes it in turn. Without this rule, closing after clicking visible metadata would close the whole album, which contradicts what the user did last. Clicking content that was already opened manually changes nothing.

Hiding, resizing and moving the window never create or rewrite groups. The title names where the application is: the root of the newest group that is in view, with its ancestors as links. A click in a cell or a resize leaves it where it is; after the Show control closed Depth 20 to show Depth 15, the title reads Depth 19, the deepest cell still open, and never names a cell that has gone.

### Deep links and browser history

The library ships no router: the host owns the log of actions and how it travels. The demo shows one shape. Its URL carries the ordered log of applied manual actions; an action every frame refused stays out, and Show, which is local to its frame, never enters it. A fresh navigation to such a link replays the log from the start, and every viewport computes its own defaults while replaying, so the result depends on the size each viewport has at that moment, because room is decided when something opens and a resize never rewrites what is open. Within a session each action pushes a history entry that also stores a snapshot of what every frame has open, so browser back, forward and reload restore that earlier state instead of replaying; content that stayed open through such a step keeps its drafts, content that closed was disposed and comes back fresh. The snapshot holds what is open, the groups and the windows as they were when the action was taken; a window change on its own writes no history entry. A click in one viewport reaches the other as the same new click: the other viewport opens whatever on the clicked path it lacks, for example cells its own up control closed, and when the click opened something new where the other viewport still had it open with deeper cells, that viewport opens it anew too. Each viewport then opens its own defaults for its own size. The up control is the exception and stays in its own viewport, because what it shows and closes depends on the size.

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
