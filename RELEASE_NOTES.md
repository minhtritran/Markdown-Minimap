Source Minimap 2.7.5 — stable width while typing

Fix incremental edits remeasuring the minimap wrapping width from a rendered editor line. Preserve the established width during typing; resize, theme, settings and mode changes still remeasure. Missing widths initialize normally, and hidden zero-width measurements retain the last valid width.

Twenty regression tests and the production build pass. The new test checks stable width across varying edit-time measurements, resize updates and hidden-pane preservation. In-app confirmation of the reported width-shifting regression is still needed.
