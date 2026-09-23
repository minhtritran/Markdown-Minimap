Source Minimap 2.7.4 — suspend hidden panes and improve cleanup

- Defer rendering, measurement and fold/scroll work for hidden or detached panes; refresh stale content when shown.
- Release closed editor roots from the shared mode observer and clear retained minimap row arrays on destruction.
- Prevent delayed view updates from recreating minimaps after closing panes or unloading/disabling the plugin.
- Update the profiler to include newly opened panes without retaining closed pane instances.

Hidden panes retain their existing minimap DOM; this change targets background CPU work and closed-pane cleanup. No measured memory or timing improvement is claimed yet.

Nineteen regression tests and the production build pass, including hidden-pane deferral and refresh-on-reveal. Update through BRAT, reload the plugin, and paste the updated profiler script before testing tab switching and closing panes.

This is a line-based Live Preview approximation, not a complete editor clone. Rich embeds, tables, math, callouts, fences and properties remain source-like in the minimap. Reading view is unchanged.
