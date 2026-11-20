---
name: cell-sweep
description: >-
  Record one clip per cell of a route in a running Supermax app: the cell alone, growing from its declared minimum width to its maximum, so its content is seen resizing and reflowing. Use to find layout problems and wrong min or max declarations, to review responsive forms, or when asked for a screencast, video or gif of cell sizes. Needs a local URL.
---

# Cell sweep

Shows how the content of each cell resizes and reflows across the widths its declaration allows. The URL names a route; every cell open on that route gets one clip, also a cell that is out of view or has no divider. A clip shows that cell and nothing else. Its frame is as wide as the cell at its largest, and the cell grows into it from its smallest width.

## What it needs

- A URL of the running app that a fresh headless Chrome can open without signing in. Ask for it when the request names none.
- A Supermax that sets `supermaxWorkspace` on the workspace's host element. The helper sizes cells through it and says so when it is missing.
- Node 22 or newer, Chrome or Chromium (`CHROME_PATH` overrides the lookup) and `ffmpeg`.
- An output directory. Use the place where the project keeps its visual checks; do not invent a new storage location.

## Run it

Resolve the plugin root, then call the helper:

```bash
resolve_supermax_root() {
  if [ -n "${CLAUDE_PLUGIN_ROOT:-}" ]; then printf '%s\n' "$CLAUDE_PLUGIN_ROOT"; return 0; fi
  if command -v codex >/dev/null 2>&1; then
    codex plugin list --json | jq -er '.installed[] | select(.pluginId == "supermax@supermax") | .source.path'
    return $?
  fi
  return 1
}
ROOT="$(resolve_supermax_root)" || { echo "supermax plugin root not found" >&2; exit 1; }
node "$ROOT/bin/cell-sweep.mjs" "<url>" --out "<directory>"
```

| Option | Default | Meaning |
| --- | --- | --- |
| `--height` | 860 | The height of the window; a cell in a row is as high as its row. |
| `--format` | `mp4` | `gif` for a place that shows no video. A gif is several times larger. |
| `--step` | 8 | Pixels the cell grows per frame; smaller is slower and smoother. |
| `--elastic-max` | 1440 | The largest width recorded for a cell that declares no maximum. |
| `--only` | every cell | Keep the cells whose destination name or title contains this text. |

The helper opens the route in a window wide enough for every cell at once, so no cell depends on Show or on a neighbour giving way. Per cell it reloads the page, waits until the content has stopped loading, and sets that cell's width from the smallest minimum among its forms to the largest maximum.

It prints one line per clip and writes `sweeps.json` beside them: per clip the file, title, occurrence, the declared bounds and the widths the cell reached; `splits` lists the splits, which have no width of their own.

## A run is complete or it failed

Every cell of the route with a width of its own has a clip, or the helper exits 1 and lists the cells without one under `missed` in `sweeps.json`, each with a reason. A split is not missing: its width follows its rows, and their cells have clips. With `--only` the run covers the matching cells and says nothing about the rest. Do not present a failed or partial run as the result, and do not explain a missing cell away: find out why it has no clip.

A cell with responsive forms is swept through all of them. The allocator shows a smaller form only when room is scarce, so for a width below the destination's own minimum the helper declares the bounds of the form that holds that width while it records. It picks that form by width alone. A form that also depends on height, or a declaration whose forms overlap, can show another form than the user gets; the line below then tells you the sweep fell short.

A line on stderr of the form "declares 88 to 320 and reached 208 to 320" is a finding, not noise: the declaration promises a width the allocator does not give, even alone in a wide window. Read the declaration and its forms before reporting it.

## Reading the clips

Watch every clip yourself before reporting. Look for:

- Content that still does not fit at the largest width: cut off, overlapping or scrolling sideways. The declared maximum is then too small, or the content needs another form.
- Content that jumps to a minimal form at a breakpoint of its own while the cell is still wide, leaving blank room beside it.
- Content that stops using the room well before the largest width, so the rest stays empty. The maximum is then too large, or the cell should declare one.
- Content that breaks at the smallest width: wrapped labels, clipped controls, unreadable figures. The declared minimum is then too small.

Report per clip the cell, the widths it covered and what you saw, and show the clips where the user looks at visual work.
