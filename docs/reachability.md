# Reachability invariant

An open cell must have a navigation route even when it has no visible pixels. Reducing the viewport, folding, resizing a surface or zooming changes its placement, not its ownership. An explicit close or replacement can remove an occurrence; a layout decision cannot.

Every completed layout contains an `access` map with one entry for every open occurrence, including cells inside a hidden split or row. Each entry identifies the next available step:

| Kind | Available route |
| --- | --- |
| `visible` | The cell has a positive allocated width. If its minimum exceeds the viewport, the workspace supplies scrolling. |
| `fold` | Open the named fold on the given axis. It has a handle of its own. |
| `back` | Use the layout's Back/Show target to move toward earlier content. |
| `zoom-out` | Leave zoom using the Show control, then continue with the ordinary layout's route. |

Configuration rejects non-finite or contradictory sizes before opening content. The allocator refuses to return a layout without an active cell or an access entry for an open occurrence. These are internal invariant failures, not warnings for a host to work around. Applications do not need to provide a fallback button or maintain a separate list of hidden cells.

## Why a route remains available

Each chain and each set of rows is a finite ordered sequence with one selected member. Zoom and the ordinary window select that member in a single precedence order; a fold a user opened does not, it only folds after the others. Allocation preserves it. Members before it may be hidden behind Back; members at or after it must be allocated or folded. A later suffix is never dropped to make an earlier selection fit.

Every fold after the selection has a `fold` route that names the fold itself. The model does not know how long a handle is drawn: on a seam too short for every handle, the handles nearest the selection show and the route of a fold beyond them is reached by opening those first. A fold before the selection has the Back route, which opens it the way its handle does, including when two small touch targets would overlap.

Back and a fold handle share one procedure. Back considers hidden descendants before their enclosing ancestors. It retains the selected positions of other scopes and proceeds toward earlier context. It may close a visible trailing subtree to free room, but never a subtree containing a cell that was hidden before the action. If that closure would discard hidden content, it preserves that subtree and allocates the requested context with folds or scrolling. A cell that becomes visible only transiently during the calculation does not count as having been shown to the user.

Revealing a cell resolves its inner chain, its row and then its containing split. The outer allocation therefore accounts for the inner demand it must contain. A full-height breakout follows its visual chain rather than requiring its logical source row to be visible.

Zoom cannot compete with an unfolded cell or an older window anchor. It always has an exit, including when no ancestor becomes visible immediately on exit. In that case the control is named `Zoom out`, rather than naming content that would still be hidden. Closing an occurrence removes references to it from all window and fold selections. Restoring a snapshot discards stale zoom references and selections outside their chain or split. Positive subpixel allocations are not rounded down to zero.

## During a drag

A fold drag interpolates between two valid layouts and resolves to one of them on release or cancellation. While it runs it closes nothing: the cells its release would close are withheld from their chain and stay open, so a cancelled drag returns them untouched. Its initial handles remain visible until release; the other handles are inert while the pointer owns the gesture. Their visibility does not change when the moving edges approach one another.

The gutter follows the current row heights. A zero-height row contributes no gutter, and the first row with a footprint adds no second gutter below the title. The row allocation and the handle use that same geometry in both drag directions and during the remaining animation after release.

## Executable checks

`test/reachability.test.js` follows the reported routes until each target is allocated. It rejects a repeated state, a missing control, a target removed before it is reached, an empty active layout and zero-width allocated content. The cases cover chains up to twenty cells, two to four rows, fold opt-outs, reserved folds, kept cells, full-height breakouts, zoom, window selections, fractional sizes, snapshots and sequences of resizing, opening and closing.

Browser tests separately check that allocated overflow can be scrolled into the real hit-test area and clicked, and that the model's folds have handles. The Coast drag regression samples multiple positions in both directions under Veil, Origami and Paper Fold. The main demo sweep exercises every scenario at narrow and short sizes.

The invariant certifies the open occurrence tree and its navigation routes. A `visible` entry means allocated content, possibly outside the current scroll position; it does not assert that every pixel is currently on screen. Physical pointer or touch access also requires a displayed viewport large enough to operate a control. The browser checks verify that separate condition at the tested sizes. Content that a host explicitly closes or replaces, a host-owned modal that intentionally blocks input, or an element with no displayed viewport does not constitute a hidden layout cell without a route.
