Source Minimap 2.7.0 — Live Preview indentation

- Preserve tabs, nested numbered/bulleted lists and blank rows in Live Preview.
- Use the editor's font, tab width, wrapping and letter spacing in both editing modes.
- Render common inline formatting without its delimiters; keep source syntax on active editor lines.
- Use source-line navigation and actual CodeMirror fold ranges in Live Preview too.
- Preserve the working automatic right padding and independent source-minimap plugin ID.

Eleven regression tests and the production build pass. Not visually verified inside Obsidian; please check your indented note after updating through BRAT.

This is a line-based Live Preview approximation, not a complete editor clone. Rich embeds, tables, math, callouts, fences and properties remain source-like in the minimap. Reading view is unchanged.
