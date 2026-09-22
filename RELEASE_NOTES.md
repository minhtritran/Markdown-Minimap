Source Minimap 2.6.3 — automatic right padding without pane resizing

- Remove Make room for the minimap and the source-view width, margin-shifting and clipping rules that affected the left gutter.
- Use the working .cm-scroller padding-right and box-sizing: border-box approach instead.
- Calculate the required padding from the minimap's rendered left edge with a 12px gap, preserving larger theme padding. Recalculate when the pane or minimap scale changes.
- No new setting is needed. Ignore the old reserveSpace value and clean up obsolete layout markers.

Eight regression tests and the production build pass. In-app visual confirmation in the user's Obsidian theme remains necessary.

Update Source Minimap through BRAT and reload the plugin. Its separate plugin ID remains source-minimap.
