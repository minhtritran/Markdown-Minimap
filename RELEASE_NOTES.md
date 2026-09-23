Source Minimap 2.7.3 — avoid editor reflow during typing

- Preserve the current right-padding reservation during incremental edits instead of removing and recalculating it through repeated layout passes.
- Stop scheduling two additional full resize passes after each incremental edit.
- Still refresh typography, document geometry, folds and navigation during edits.
- Keep full padding recalculation for initial rendering, resizing, theme/settings changes and mode changes; recover if the padding class is missing.

Targets expensive document-metric synchronization identified through in-app profiling. The JavaScript rendering microbenchmark does not measure this browser layout work, so no new timing improvement is claimed until another in-app profile is collected.

Seventeen regression tests and the production build pass. Includes a render-lifecycle regression verifying that edits update navigation without triggering resize timers, while full renders retain the settling path. Update through BRAT, reload the plugin, and repeat the same profiler session.

This is a line-based Live Preview approximation, not a complete editor clone. Rich embeds, tables, math, callouts, fences and properties remain source-like in the minimap. Reading view is unchanged.
