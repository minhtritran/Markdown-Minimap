Source Minimap 2.7.7 — light-theme contrast

Use the theme's primary note background for the minimap instead of a potentially transparent container color. Preserve fully transparent fallback colors rather than turning transparent black into a grey overlay.

In light themes, tint the viewport marker with the theme accent and add an inset outline. Existing background, text and marker opacity settings continue to apply. Dark-theme marker styling is unchanged.

Twenty-three regression tests and the production build pass. Visual confirmation in the user's Obsidian theme remains outstanding.
