# Performance measurements

Run `npm run benchmark` from the repository root. The harness bundles the actual
renderer with esbuild and measures 1,000, 6,000 and 20,000-line synthetic notes.
Each case has eight warmups and 35 measured operations; reports contain median,
p95 and node allocations. Fixtures contain tabs, lists, headings, links and
formatting, with no personal note contents. `baseline.json` was captured before
the optimizations (2.7.0); `optimized.json` after both iterations on the same host.

| Lines | Typing median before | After | Nodes before | After |
| --- | ---: | ---: | ---: | ---: |
| 1,000 | 1.432 ms | 0.318 ms | 6,066 | 21 |
| 6,000 | 13.044 ms | 2.011 ms | 36,408 | 19 |
| 20,000 | 41.099 ms | 6.830 ms | 121,348 | 19 |

Cursor-line updates allocate about 10 nodes instead of the entire document;
same-line cursor updates allocate zero nodes. Opening a document remains a full
render: no meaningful improvement is claimed there. Typing fixtures append a
character and move the active line, exercising both changes together.

These are JavaScript microbenchmarks using a minimal DOM, **not Obsidian frame
times**. They exclude browser layout/paint, actual Prism, themes and other
plugins. Tiny selection timings are below useful precision. Node allocation
counts provide a more stable signal than timing ratios. Avoid hard CI latency
thresholds on shared machines.

## Actual Obsidian measurements

The profiler now reports approximate app-wide JavaScript heap usage and minimap
element counts before/after the session. Neither is retained plugin memory:
use DevTools heap snapshots and retaining paths for that. Samples are capped at
10,000 so leaving the profiler running does not grow its arrays without bound.

Paste `obsidian-console.js` into the desktop developer console. It instruments
current minimap instances temporarily; no note content is collected. Repeat on
the same note, theme, pane width and plugin set before/after updating:

1. Warm up the note; call `sourceMinimapPerf.reset()`.
2. Move the cursor within one line, then across 100 lines; type 100 characters.
3. Repeat in Source mode and Live Preview. Include a code-heavy note.
4. Insert/delete lines; edit a fence; fold/unfold; resize; scroll; switch notes.
5. Call `sourceMinimapPerf.stop()` and save the reported counts, median and p95.
6. Use the DevTools Performance recording for frame/layout/paint timing and GC.

Profiler method timings overlap and must not be summed. Long tasks cover the
whole app, not just this plugin. Prototype hooks now include newly opened panes
and do not retain closed pane instances. Restart the profiler after reloading
the plugin itself.

For the hidden-pane change, open a second tab, edit and switch back, then close
one tab. Verify the minimap catches up when shown and the reported pane count
drops after closing. Hidden panes retain their DOM but defer render/measurement
work; app-wide heap fluctuations still cannot establish plugin memory savings.
In-app measurements have not been run here.

## Guardrails and remaining costs

Regression tests compare incremental rows with fresh rendering for selection,
focus loss, edits, fences, frontmatter, insertions/deletions and mode changes.
Existing folds, navigation and padding tests also run. Selection updates do not
reclassify or rehighlight the note. Same-line selection changes skip measurement.
Edits retain unchanged ordinary rows but still reclassify the complete note, so
changing a fence cannot leave stale formatting below it. Code/frontmatter rows
are rebuilt to preserve Prism readiness and language changes. Insert/delete and
explicit file/mode renders conservatively rebuild rows. Cross-line selection
changes still measure the source map, and typing still performs layout work.

## 2.7.2 follow-up

`optimized-2.7.2.json` records a follow-up run of the same benchmark:

| Lines | 2.7.1 typing median | 2.7.2 typing median |
| --- | ---: | ---: |
| 1,000 | 0.318 ms | 0.369 ms |
| 6,000 | 2.011 ms | 0.717 ms |
| 20,000 | 6.830 ms | 4.856 ms |

Small notes showed no benefit in this run. These are single-process benchmark
samples, not a controlled Obsidian comparison. Initial opening remains costly.

Same-line-count edits within letter-led prose now reuse classification when
indentation remains unchanged. Other edits still use the full parser. Reused
classification also permits reuse of highlighting and unchanged code rows;
Prism readiness changes invalidate that reuse. Cached token data belongs only
to the current rendered document, not a history of edits. This trades some
retained token memory for less repeated CPU work; no net memory saving is claimed.

Geometry capture now reads offsetHeight once and offsetTop once per visible row,
reuses its row records and drops obsolete entries. The immediate duplicate fold
and geometry pass before afterRender was removed. Regression tests assert read
counts and mapping behavior; actual browser layout timing is still unmeasured.
