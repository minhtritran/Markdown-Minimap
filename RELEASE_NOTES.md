Source Minimap — a separately installable Source-mode fork of Markdown Minimap 2.6.0.

- Keep the full-note minimap layout stable while CodeMirror measures newly visited lines.
- Map navigation by source line, including notes without headings and wrapped lines.
- Fix clicks on a panned minimap to target the text under the pointer.
- Reserve space from the scaled minimap width rather than requiring a fixed CSS gutter.
- Match editor tabs, whitespace, wrapping and letter spacing.
- Add independent Text opacity (55% default).
- Refresh source edits on the next frame and mirror CodeMirror fold ranges.

Validation: eight regression tests, TypeScript check and production build passed. Not visually verified inside Obsidian. The separate renderer can still differ with custom themes, hanging indents, inline fold replacements and third-party editor decorations; Live Preview and Reading mode keep the upstream renderer.

BRAT repository: minhtritran/Markdown-Minimap. Its plugin ID is source-minimap, so the original Markdown Minimap and its settings remain untouched. Disable the original while using this fork to avoid overlapping minimaps. The fork uses its own CSS namespace and device preference key.
