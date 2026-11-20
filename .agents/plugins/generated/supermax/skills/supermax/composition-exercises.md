# Composition exercises

Use these optional probes to challenge a proposal. They test task reasoning and legal composition, not runtime usability. Dimensions are hypothetical CSS viewport sizes; measure actual workspace space after chrome and validate declarations before claiming fit.

## Browsing while monitoring work

A collection has background activity, configuration controls and processing status. Its work surface also has filters with counts. Determine whether these choices filter one collection or open independent work, and whether monitoring must stay visible during browsing.

Compare a list-detail chain with settings on demand against a browsing/operations split. The chain preserves height for the main task; independent operations can justify a supporting row when users need job selection and progress alongside browsing. A separate filtered-work row needs its own useful content and selection, not just filter buttons. Other patterns and combinations remain valid.

For frequent monitoring, a candidate is a collection split with browsing above operations. Filters belong to the work collection. Status and a settings action remain concise at every size; a separate settings task exposes all independent role choices. The main row receives useful growth; operations gets only the height its task needs.

These maps hold the same state: navigation, collection split, selected work and a document opened from that work are all open. `*` marks active content, `~` its scroll owner, `R` a kept compact navigation rail, and `F` the single full-height breakout. Rows inside a split have independent horizontal chains; their column boundaries need not align.

```text
Wide/tall: proposed 1440 x 1000
+-----+---------------------------+---------------------+
| Nav | Browse ~ -> Work ~        | F: document* ~      |
|     | [collection filters]      |                     |
|     |---------------------------|                     |
|     | Operations ~ -> Job ~     |                     |
+-----+---------------------------+---------------------+

Wide/short: proposed 1440 x 620
+-----+---------------------------+---------------------+
| Nav | Browse ~ -> Work ~        | F: document* ~      |
|     |---------------------------|                     |
|     | Operations ~ -> Job ~     |                     |
+-----+---------------------------+---------------------+
Hypothesis: less row height, same controls and selections, independent scroll.
Reject if either complete task fails at its measured row minimum.

Narrow/tall: proposed 720 x 1000
+---+----------------------------------+
| R | F: document* ~                    |
|   |                                  |
|   |                                  |
+---+----------------------------------+

Narrow/short: proposed 720 x 620
+---+----------------------------------+
| R | F: document* ~                    |
+---+----------------------------------+
Less document height; the source split stays open but outside the window.
```

Fit is conditional on actual bounds. At narrow widths, Show can recover the source split by closing the document; protect an unsaved editor if it replaces that document task. Resizing alone does not open or close either. Returning to browsing is a separate interaction: draw its state separately, including which rows Show brings back. `ifRoom` can offer a document on navigation, not manufacture this opening on resize.

A useful review explains the height cost and independent value of each proposed row, preserves control scope and recovery, and revises the choice when monitoring or filter assumptions change. It checks the same state's fit across sizes before comparing different tasks. Merely converting existing strips into rows does not answer the design question. Justify the minimum size with a completed task: can the user identify a failed operation, act on it and return without losing the browsing selection? If the answer changes at short height, change the composition or bounds instead of relying on future vertical hiding.

## Investigating a case while drafting an assessment

Inventory: portfolio navigation, case queues, case summary, documents, evidence list, activity history, correspondence, editable assessment, approval actions, processing jobs, audit history and reporting. Reconcile evidence against an assessment, request clarification, then resume the draft after checking a failed job. Include parallel case tabs and an existing mobile entry point in the context inventory.

Compare a queue → case → evidence → document → assessment chain with independent evidence/correspondence rows plus a full-height assessment. The chain offers full-height reading but may hide required source context. The split preserves independent selections at the cost of row height. It supports one breakout, so a second document and editor cannot both be separate breakouts of that split; a breakout's own chain can continue to the right. Check whether that ancestry matches the task before using it.

Prefer the split only if the evidence remains readable beside the assessment. Otherwise examine another comparison pattern, a task-specific root-chain composition, or alternating views with retained drafts when simultaneous reading is unnecessary. Explain which task each choice supports and what is lost. Audit and reporting have their own routes; jobs open when relevant; approval actions belong to the assessment. No single screen needs the entire inventory.

Draw wide/short, wide/tall, narrow/short and narrow/tall views of the same selected case and draft, then show the interruption and return as separate transitions. Test long evidence, keyboard access, identity continuity, hidden drafts, Show, explicit closing, failed jobs, deep links and mobile access. Refuse a composition that makes the evidence unreadable at supported sizes. Propose another pattern even if it is absent from the skill's examples; explain its behavior without forcing it into a listed category.

Challenge the proposal with a task absent from these examples: peers with shared controls, a bulk operation, a record revisited through another route, or a mode where selecting an item mutates work instead of navigating. Choose probes from the actual product, and distinguish shared data from occurrence-local state. Explain which parts belong inside one task surface and which deserve independent shell navigation.

The proposal is useful when every inventoried task has a place, required simultaneous work is feasible, and unresolved choices are visible. For each disappearing surface, name what becomes unavailable, why the active task tolerates that, and how it is recovered. Test the actual content at minimum and preferred sizes; do not award a pass merely because rectangles fit. Actual usability still needs render and interaction checks with realistic content.
