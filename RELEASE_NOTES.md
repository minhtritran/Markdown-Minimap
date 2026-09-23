Source Minimap 2.7.6 — resync the viewport marker after tab changes

- Reject collapsed or stale editor block geometry when preparing the minimap source map.
- Hide the editing-mode marker while its document snapshot or source map is invalid rather than drawing a full-track fallback highlight.
- Listen for CodeMirror geometry/viewport changes and coalesce marker resynchronization into an animation frame, without rebuilding the document or recalculating width.
- Cancel the pending synchronization frame on destruction. Legitimate short-note highlights remain supported.

Twenty-two regression tests and the production build pass, including geometry recovery and coalesced synchronization. The reported intermittent full-minimap highlight still needs in-app confirmation after updating through BRAT.
