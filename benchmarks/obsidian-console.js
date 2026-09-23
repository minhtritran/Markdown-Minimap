// Paste into Obsidian desktop's developer console with the plugin enabled.
// Run the same note/actions with each version; stop before switching versions.
(() => {
    window.sourceMinimapPerf?.stop();
    const plugin = app.plugins.plugins['source-minimap'];
    if (!plugin) throw new Error('Enable Source Minimap first');
    const records = [];
    const restores = [];
    const longTasks = [];
    for (const note of plugin.minimapInstances.values()) {
        for (const method of ['renderSourceText', 'getScrollMetrics', 'syncDocumentMetrics']) {
            const original = note[method];
            const wrapped = function (...args) {
                const start = performance.now();
                try { return original.apply(this, args); }
                finally { records.push({ method, ms: performance.now() - start }); }
            };
            note[method] = wrapped;
            restores.push(() => { if (note[method] === wrapped) note[method] = original; });
        }
    }
    const observer = new PerformanceObserver(list => {
        longTasks.push(...list.getEntries().map(e => e.duration));
    });
    if (PerformanceObserver.supportedEntryTypes.includes('longtask')) observer.observe({ type: 'longtask' });
    const report = () => {
        const rows = [...new Set(records.map(r => r.method))].map(method => {
            const samples = records.filter(r => r.method === method).map(r => r.ms).sort((a,b) => a-b);
            return { method, calls: samples.length, medianMs: samples[Math.floor(samples.length/2)],
                p95Ms: samples[Math.min(samples.length-1, Math.floor(samples.length*.95))] };
        });
        console.table(rows);
        console.log('Whole-app long tasks (not necessarily caused by the minimap):', longTasks);
        return { rows, longTasks: [...longTasks] };
    };
    window.sourceMinimapPerf = {
        report,
        reset() { records.length = 0; longTasks.length = 0; },
        stop() { restores.forEach(restore => restore()); observer.disconnect(); return report(); }
    };
    console.log('Profiling current panes. Run sourceMinimapPerf.stop() when finished. Timings overlap; do not sum them.');
})();
