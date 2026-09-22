Source Minimap 2.6.2 — editor/minimap overlap fix

- Reserve a separate strip outside the Source-mode editor instead of padding CodeMirror's flex scroller. The editor can no longer lay out text across the minimap strip.
- Calculate the strip from the minimap scale and actual text width, with a 12px gap. No fixed 190px gutter.
- Recalculate on resize and remove the reserve when switching modes or disabling the plugin. Hidden panes retain their last measured reserve.

Validation: eight regression tests, TypeScript and production build. The reported Obsidian/theme combination still needs an in-app visual check.

Update Source Minimap through BRAT. Keep Make room for the minimap enabled. This remains separate from the original Markdown Minimap plugin and settings.
