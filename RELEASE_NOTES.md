Source Minimap 2.7.8 — live theme background

Remove the JavaScript-cached inline background color. Draw the minimap background in an isolated CSS layer using the current --background-primary value, so theme changes cannot leave an old dark tint behind. Clear any previous inline background and preserve independent background, text and marker opacity settings.

Twenty-three existing regression tests and the production build pass. The light-theme visual fix still needs confirmation in Obsidian after updating and reloading the plugin.
