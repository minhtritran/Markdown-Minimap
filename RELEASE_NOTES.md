Source Minimap 2.7.1 — incremental rendering

- Update only lines whose active state changes when moving the Live Preview cursor. Skip rendering and measurement for movement within the same line.
- Reuse unchanged ordinary rows when typing in Source mode and Live Preview.
- Remove the duplicate delayed Live Preview editor-change refresh.
- Keep full document classification for correctness after structural Markdown edits, and rebuild on explicit file/mode changes.
- Include a repeatable benchmark and an optional Obsidian console profiler under benchmarks/.

Synthetic 6,000-line typing renderer median improved from 13.044 ms to 2.011 ms; at 20,000 lines, 41.099 ms to 6.830 ms. These are JavaScript microbenchmarks, not Obsidian frame times; layout, paint and Prism are excluded. Initial document opening is not materially improved.

Thirteen regression tests and the production build pass, including incremental-versus-full rendering comparisons. In-app visual and performance verification remains outstanding.

This is a line-based Live Preview approximation, not a complete editor clone. Rich embeds, tables, math, callouts, fences and properties remain source-like in the minimap. Reading view is unchanged.
