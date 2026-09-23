// Paste into Obsidian desktop's developer console with the plugin enabled.
// Run the same note/actions with each version; stop before switching versions.
(() => {
    window.sourceMinimapPerf?.stop();
    const plugin = app.plugins.plugins['source-minimap'];
    if (!plugin) throw new Error('Enable Source Minimap first');
    const records = [];
    const sampleLimit = 10000;
    let dropped = 0;
    const restores = [];
    const longTasks = [];
    for (const note of plugin.minimapInstances.values()) {
        for (const method of ['renderSourceText', 'getScrollMetrics', 'syncDocumentMetrics']) {
            const original = note[method];
            const wrapped = function (...args) {
                const start = performance.now();
                try { return original.apply(this, args); }
                finally {
                    if (records.length < sampleLimit) records.push({ method, ms: performance.now() - start });
                    else dropped++;
                }
            };
            note[method] = wrapped;
            restores.push(() => { if (note[method] === wrapped) note[method] = original; });
        }
    }
    const observer = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) if (longTasks.length < sampleLimit) longTasks.push(entry.duration);
    });
    if (PerformanceObserver.supportedEntryTypes.includes('longtask')) observer.observe({ type: 'longtask' });
    const snapshot = () => ({
        // Chromium's heap counter is app-wide and approximate, not plugin memory.
        appHeapBytes: performance.memory?.usedJSHeapSize ?? null,
        panes: [...plugin.minimapInstances.values()].map(note => ({
            visible: !!note.container?.getClientRects().length,
            rows: note.sourceLineElements?.length ?? 0,
            domElements: note.content?.querySelectorAll('*').length ?? 0
        }))
    });
    let initial = snapshot();
    const report = () => {
        const rows = [...new Set(records.map(r => r.method))].map(method => {
            const samples = records.filter(r => r.method === method).map(r => r.ms).sort((a,b) => a-b);
            return { method, calls: samples.length, medianMs: samples[Math.floor(samples.length/2)],
                p95Ms: samples[Math.min(samples.length-1, Math.floor(samples.length*.95))] };
        });
        console.table(rows);
        console.log('Whole-app long tasks (not necessarily caused by the minimap):', longTasks);
        const memory = { initial, current: snapshot() };
        console.log('Approximate app heap and minimap element counts:', memory);
        console.log('Samples omitted after limit:', dropped);
        return { rows, longTasks: [...longTasks], memory, dropped };
    };
    window.sourceMinimapPerf = {
        report,
        reset() { records.length = 0; longTasks.length = 0; dropped = 0; initial = snapshot(); },
        stop() { restores.forEach(restore => restore()); restores.length = 0; observer.disconnect(); return report(); }
    };
    console.log('Profiling current panes. Run sourceMinimapPerf.stop() when finished. Timings overlap; do not sum them.');
})();
