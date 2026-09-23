Source Minimap 2.7.2 — prose parsing and geometry costs

- Reuse classification for safe prose edits, with full parsing for structural changes.
- Reuse code highlighting and rows during those prose edits; invalidate on code or Prism readiness changes.
- Remove a duplicate geometry pass; read each row metric once and reuse mapping records.
- Extend the optional console profiler with approximate app heap and minimap element counts; cap collected samples.

Synthetic 6,000-line typing renderer median improved from 2.011 ms in 2.7.1 to 0.717 ms; at 20,000 lines, 6.830 ms to 4.856 ms. Small notes did not improve in this run. These are JavaScript microbenchmarks, not Obsidian frame times; layout, paint and Prism are excluded. No overall memory reduction is claimed.

Sixteen regression tests and the production build pass, including structural-edit equivalence, highlighting invalidation and geometry read counts. In-app visual, CPU and retained-memory verification remains outstanding. See benchmarks/README.md for the repeatable profiling procedure.

This is a line-based Live Preview approximation, not a complete editor clone. Rich embeds, tables, math, callouts, fences and properties remain source-like in the minimap. Reading view is unchanged.
