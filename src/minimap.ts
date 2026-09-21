import { Component, MarkdownRenderer, MarkdownView } from "obsidian";
import { EditorView } from "@codemirror/view";
import { prepareBlankLineRuns } from "./blank-lines";
import type { BlankLineRun } from "./blank-lines";
import {
    AnchorTracker,
    collectRenderedHeadings,
    readCachedHeadings,
} from "./anchors";
import { mirrorCodeMetrics, mirrorDocumentMetrics } from "./document-metrics";
import {
    applyFoldsToPanel,
    readFoldHeads,
    resolveFoldRanges,
} from "./folds";
import {
    cloneMetadataWidget,
    findInlineTitle,
    findMetadataContainer,
    renderFrontmatter,
} from "./frontmatter";
import { MinimapPointer } from "./pointer";
import type { PointerHost } from "./pointer";
import {
    applySourceFolds,
    sourceFoldSignature,
    buildSourceLineDom,
} from "./source-view";
import { SourceMap } from "./source-map";
import { isPrismReady, warmPrism } from "./prism";
import {
    computeScrollMetrics,
    resolveDocumentHeights,
} from "./scroll-model";
import type { ScrollMetrics } from "./scroll-model";
import type { MarkdownMinimapSettings } from "./settings";
import type NoteMinimap from "./main";
import { clamp, computedStyle, pixels, toRGBAAlpha } from "./utils";

export class Minimap implements PointerHost {
    plugin: NoteMinimap;
    view: MarkdownView;
    element: HTMLElement;
    sourceView: HTMLElement;
    scroller: HTMLElement | null = null;
    container: HTMLDivElement | null = null;
    /** Positions and scales the panel; carries no Obsidian classes. */
    viewport: HTMLDivElement | null = null;
    content: HTMLDivElement | null = null;
    slider: HTMLDivElement | null = null;
    hitbox: HTMLDivElement | null = null;
    renderComponent: Component | null = null;
    scale = 0.1;
    minimapOpacity = 0.3;
    textOpacity = 0.55;
    sliderOpacity = 0.3;
    sliderIdleOpacity = 0.09;
    topOffset = 0;
    bottomOffset = 0;
    scrollbarGutter = 14;
    minViewportHeight = 24;
    reserveSpace = false;
    centerOnClick = true;
    backgroundColor = "";
    renderVersion = 0;
    trailingSyncTimer = 0;
    /** Pending second measuring pass after a pane resize. */
    private resizeSettleTimer = 0;
    private resizeTimer = 0;
    private sourceRenderFrame = 0;

    readonly anchors = new AnchorTracker();
    private readonly pointer = new MinimapPointer(this);
    /** Heading source lines from the last render, paired with the anchors. */
    private headingLines: number[] = [];
    /** Heading levels from the last render, parallel to `headingLines`. */
    private headingLevels: number[] = [];
    /** Source line count from the last render, bounding a fold to the end. */
    private lineCount = 0;
    /** Heading ordinals the panel has folded away. */
    private hiddenHeadings: ReadonlySet<number> = new Set();
    /** Fold heads the panel is currently mirroring, for change detection. */
    private foldSignature = "";
    private foldObserver: MutationObserver | null = null;
    private foldCheckTimer = 0;
    /** Whether a real code line has been measured for this view yet. */
    private codeMetricsMirrored = false;
    /** Source-mode line elements, index 0 being source line 1. */
    private sourceLineElements: HTMLElement[] = [];
    private readonly sourceMap = new SourceMap();
    private sourceMapInUse = false;
    /**
     * Whether the last metrics pass mapped through the anchors. The thumb's
     * position and the pointer's target have to come from the same mapping, so
     * this is what the pointer asks rather than whether anchors merely exist.
     */
    private anchorsInUse = false;

    constructor(
        plugin: NoteMinimap,
        view: MarkdownView,
        settings: MarkdownMinimapSettings
    ) {
        this.plugin = plugin;
        this.view = view;
        this.element = view.contentEl;
        const sourceView = this.element.querySelector<HTMLElement>(
            ".markdown-source-view"
        );
        if (!sourceView)
            throw new Error("Markdown Minimap requires a source view.");
        this.sourceView = sourceView;

        this.setupElements();
        this.observeFolds();
        this.updateSettings(settings);
        this.modeChange();

        if (this.hitbox) this.pointer.attach(this.hitbox);
    }

    // --- lifecycle -------------------------------------------------------

    setupElements() {
        this.element
            .querySelectorAll(
                ".source-minimap-container, .source-minimap-viewport, .source-minimap-content, .source-minimap-slider, .source-minimap-hitbox"
            )
            .forEach((e) => e.remove());

        const container = activeDocument.createElement("div");
        container.className = "source-minimap-container";
        this.container = container;
        this.element.prepend(container);

        // The panel is positioned by this wrapper and rendered by the element
        // inside it, which is not a distinction the panel used to draw. The
        // rendered element wears Obsidian's own "markdown-preview-view" so the
        // note's Markdown styling applies to the copy — but Obsidian styles
        // that class too, `position: relative` among them, and on mobile a rule
        // of its own outranked the panel's `position: absolute`. The panel then
        // took its static position at the container's left edge, so instead of
        // being pinned to the right of the pane it landed a document-width in
        // from the left: mid-screen on a tablet in landscape, and drifting as
        // the note's width changed. Issue #11.
        //
        // Splitting the two means the placement no longer rides on a class
        // Obsidian is free to style. The wrapper carries a name nothing else
        // targets, and the rendered element inside it is in normal flow with no
        // offsets of its own, so a rule that moves it has nothing to move.
        this.viewport = activeDocument.createElement("div");
        this.viewport.className = "source-minimap-viewport";
        container.appendChild(this.viewport);

        this.content = activeDocument.createElement("div");
        // "show-properties" is what re-enables Obsidian's own rule for the
        // properties widget; rendered Markdown hides it by default, so without
        // this the cloned properties collapse to zero height and render blank.
        this.content.className =
            "source-minimap-content markdown-preview-view markdown-rendered show-properties";
        this.viewport.appendChild(this.content);

        this.slider = activeDocument.createElement("div");
        this.slider.className = "source-minimap-slider";
        container.appendChild(this.slider);

        this.hitbox = activeDocument.createElement("div");
        this.hitbox.className = "source-minimap-hitbox";
        container.appendChild(this.hitbox);
    }

    /**
     * Folding fires no event a plugin can subscribe to, so the panel watches for
     * the DOM churn a fold causes and re-reads Obsidian's own fold state when it
     * settles. The read is compared against a signature before any work is done,
     * which is what makes it safe to hang off a noisy observer: on a 6,000-line
     * note the read costs about 1.5ms, and only a genuine change gets past it.
     *
     * Neither root contains the panel, so the panel's own updates cannot feed
     * back into this.
     */
    private observeFolds() {
        this.foldObserver = new MutationObserver(this.onPossibleFoldChange);
        const options: MutationObserverInit = {
            childList: true,
            subtree: true,
            attributes: true,
            // Collapsing a heading or the properties widget toggles a class;
            // folding in the editor swaps the lines out. Watching both covers
            // every mode without needing to know which one is showing.
            attributeFilter: ["class"],
        };
        // The whole source view, not just the editor's content: the properties
        // widget sits outside it, so collapsing the properties went unnoticed.
        this.foldObserver.observe(this.sourceView, options);
        const readingView = this.element.querySelector<HTMLElement>(
            ".markdown-reading-view"
        );
        if (readingView) this.foldObserver.observe(readingView, options);
    }

    private onPossibleFoldChange = () => {
        window.clearTimeout(this.foldCheckTimer);
        this.foldCheckTimer = window.setTimeout(this.checkFolds, 200);
    };

    private checkFolds = () => {
        if (this.syncFoldState()) void this.onResize();
    };

    /**
     * Re-read the note's fold state and fold the panel to match. Returns
     * whether anything actually moved, so the caller can decide whether a
     * re-measure is warranted.
     *
     * Called from the scroll settle and from `onResize` as well as from the
     * observer, because the observer alone is not enough: CodeMirror only
     * renders near the viewport, so folding a section that is already below it
     * changes the editor's height without touching a single node the observer
     * can see.
     */
    private syncFoldState(): boolean {
        if (!this.content) return false;
        // Collapsing the properties widget changes its height without changing
        // anything the Markdown renderer produced, so re-pin rather than
        // re-render the whole note. Checked before the signature, since the
        // widget can also be resized by editing a property.
        if (this.isRawSourceMode()) {
            const signature = sourceFoldSignature(this.getEditorView());
            if (signature === this.foldSignature) return false;
            this.foldSignature = signature;
            this.refreshSourceLayout();
            return true;
        }
        const resized = this.syncFrontmatterHeight();
        const heads = readFoldHeads(this.view);
        const signature = heads.join(",");
        if (signature === this.foldSignature) return resized;
        this.foldSignature = signature;
        this.applyFolds(heads);
        return true;
    }

    /**
     * Source mode applies actual CodeMirror fold ranges separately.
     */
    private applyFolds(foldHeads: number[]) {
        if (this.isRawSourceMode()) {
            this.hiddenHeadings = new Set();
            return;
        }
        const ranges = resolveFoldRanges(
            foldHeads,
            this.headingLines,
            this.headingLevels,
            this.lineCount
        );
        this.hiddenHeadings = applyFoldsToPanel(
            this.content,
            this.headingLines,
            ranges
        );
    }

    /**
     * Re-measure the note's properties and resize the panel's copy to match.
     * The clone is replaced as well as re-sized so a collapsed widget reads as
     * collapsed rather than as its own top few rows behind a clip.
     */
    private syncFrontmatterHeight(): boolean {
        const wrapper = this.content?.querySelector<HTMLElement>(
            ".markdown-source-minimap-properties"
        );
        if (!wrapper) return false;
        const widget = findMetadataContainer(
            this.element,
            this.isReadModeActive()
        );
        if (!widget || widget.offsetHeight <= 0) return false;

        const height = `${widget.offsetHeight}px`;
        if (wrapper.style.height === height) return false;

        wrapper.style.height = height;
        const existing = wrapper.firstElementChild;
        if (existing?.classList.contains("metadata-container")) {
            existing.replaceWith(cloneMetadataWidget(widget));
        }
        return true;
    }

    destroy() {
        this.renderVersion++; // invalidate any in-flight render
        window.clearTimeout(this.resizeTimer);
        this.element.ownerDocument.defaultView?.cancelAnimationFrame(this.sourceRenderFrame);
        window.clearTimeout(this.trailingSyncTimer);
        window.clearTimeout(this.resizeSettleTimer);
        window.clearTimeout(this.foldCheckTimer);
        this.foldObserver?.disconnect();
        this.foldObserver = null;
        this.scroller?.removeEventListener("scroll", this.onScroll);
        this.pointer.detach(this.hitbox);

        this.renderComponent?.unload();
        this.renderComponent = null;
        this.container?.remove();
        this.element.style.removeProperty("--source-minimap-content-shift");
        this.element.style.removeProperty("--source-minimap-sizer-margin-left");
        this.element.style.removeProperty("--source-minimap-sizer-margin-right");
        this.element.classList.remove("source-minimap-content-shifted");

        this.container = null;
        this.viewport = null;
        this.content = null;
        this.slider = null;
        this.hitbox = null;
        this.scroller = null;
        this.anchors.clear();
        this.sourceMap.clear();
        this.element.classList.remove("source-minimap-source-reserved");
        this.element.style.removeProperty("--source-minimap-editor-padding-right");
    }

    // --- settings --------------------------------------------------------

    updateSettings(settings: MarkdownMinimapSettings) {
        this.scale = settings.scale;
        this.minimapOpacity = settings.minimapOpacity;
        this.textOpacity = settings.textOpacity;
        this.sliderOpacity = settings.sliderOpacity;
        this.sliderIdleOpacity = settings.sliderIdleOpacity;
        this.topOffset = settings.topOffset;
        this.bottomOffset = settings.bottomOffset;
        this.scrollbarGutter = settings.scrollbarGutter;
        this.minViewportHeight = settings.minViewportHeight;
        this.reserveSpace = settings.reserveSpace;
        this.centerOnClick = settings.centerOnClick;

        this.backgroundColor = toRGBAAlpha(
            this.element.getCssPropertyValue("background-color"),
            this.minimapOpacity
        );

        this.updateSettingsInCSS();
        void this.onResize();
    }

    updateSettingsInCSS() {
        if (this.container) {
            this.container.style.setProperty("--source-minimap-scale", String(this.scale));
            this.container.style.setProperty("--source-minimap-text-opacity", String(this.textOpacity));
            this.container.style.setProperty(
                "--source-minimap-top-offset",
                `${this.topOffset || 0}px`
            );
            this.container.style.setProperty(
                "--source-minimap-bottom-offset",
                `${this.bottomOffset || 0}px`
            );
            this.container.style.setProperty(
                "--source-minimap-scrollbar-gutter",
                `${this.scrollbarGutter || 0}px`
            );
            // The thumb has three states, so the settings are published as
            // variables the stylesheet resolves rather than a fixed opacity.
            // An inline opacity here would override every one of them.
            this.container.style.setProperty(
                "--source-minimap-slider-opacity",
                String(this.sliderOpacity)
            );
            this.container.style.setProperty(
                "--source-minimap-slider-idle-opacity",
                String(this.sliderIdleOpacity)
            );
        }
        if (this.content)
            this.content.style.backgroundColor = this.backgroundColor;
        // The reserve is measured, so it is recomputed with the rest of the
        // document metrics rather than written directly from the setting.
        this.syncDocumentMetrics();
    }

    /**
     * Page-space left edge of the visible minimap strip. Measured from the
     * hitbox, which is the strip: deriving it from the doc width and scale
     * would ignore that the container spans the whole view rather than the
     * scroller's content box.
     */
    getStripLeft() {
        const rect = this.hitbox?.getBoundingClientRect();
        return rect && rect.width > 0 ? rect.left : 0;
    }

    // --- mode and scroller ------------------------------------------------

    // Ask the view for its mode instead of inferring it from layout; a
    // hidden tab measures 0 everywhere and would misread as reading mode.
    isReadModeActive() {
        return this.view.getMode() === "preview";
    }

    // Source mode with Live Preview off prints the file verbatim: no rendered
    // embeds, no widgets. Live Preview and reading view both render them.
    isRawSourceMode() {
        return (
            !this.isReadModeActive() &&
            !this.sourceView.classList.contains("is-live-preview")
        );
    }

    // Scope to the reading view so we never match the minimap's own
    // content div, which also carries .markdown-preview-view.
    getExpectedScroller() {
        return this.element.querySelector<HTMLElement>(
            this.isReadModeActive()
                ? ".markdown-reading-view .markdown-preview-view"
                : ".cm-scroller"
        );
    }

    modeChange() {
        // The two modes need different code metrics, and the reading view
        // needs none at all.
        this.codeMetricsMirrored = false;
        this.syncScroller();
    }

    // Instances created while their tab was hidden may track a stale
    // element; re-resolve before measuring so the scroll listener always
    // follows the live scroller.
    syncScroller() {
        const next = this.getExpectedScroller();
        if (next === this.scroller) return;
        this.scroller?.removeEventListener("scroll", this.onScroll);
        this.scroller = next;
        if (this.scroller) {
            this.scroller.addEventListener("scroll", this.onScroll);
            void this.onResize();
        }
    }

    getEditorView() {
        const editorElement =
            this.sourceView.querySelector<HTMLElement>(".cm-editor");
        return editorElement ? EditorView.findFromDOM(editorElement) : null;
    }

    /** Distance from the scroller's scroll origin to the CodeMirror content. */
    getEditorContentOffset() {
        const cmContent =
            this.sourceView.querySelector<HTMLElement>(".cm-content");
        if (!cmContent || !this.scroller) return 0;
        return (
            cmContent.getBoundingClientRect().top -
            this.scroller.getBoundingClientRect().top +
            this.scroller.scrollTop
        );
    }

    // --- measurement ------------------------------------------------------

    syncDocumentMetrics() {
        if (!this.container || !this.content) return;
        mirrorDocumentMetrics({
            element: this.element,
            container: this.container,
            content: this.content,
            readMode: this.isReadModeActive(),
            rawSourceMode: this.isRawSourceMode(),
            stripLeft: this.getStripLeft(),
            reserveSpace: this.reserveSpace,
            scale: this.scale,
            scrollbarGutter: this.scrollbarGutter,
        });
        this.syncCodeBlockMetrics();
    }

    syncCodeBlockMetrics() {
        if (!this.content || !this.container) return;
        // Reading view renders the same markup the minimap does, and Source
        // mode has no rendered code blocks to correct.
        if (this.isReadModeActive() || this.isRawSourceMode()) {
            this.content.classList.remove("source-minimap-mirror-code");
            this.codeMetricsMirrored = false;
            return;
        }
        if (this.codeMetricsMirrored) return;
        this.codeMetricsMirrored = mirrorCodeMetrics(
            this.sourceView,
            this.container,
            this.content
        );
    }

    // A hidden or not-yet-rendered pane measures 0 everywhere, which is
    // indistinguishable from "the note genuinely shows no properties".
    isPaneMeasurable() {
        const scroller = this.getExpectedScroller();
        return !!scroller && scroller.clientHeight > 0;
    }

    // Obsidian's "Properties in document" setting, used only to break the tie
    // when the pane cannot be measured.
    getPropertiesDisplayMode() {
        const vault = this.plugin.app.vault as unknown as {
            getConfig?: (key: string) => unknown;
        };
        const mode = vault.getConfig?.("propertiesInDocument");
        return typeof mode === "string" ? mode : "visible";
    }

    applyBlankLineHeights(
        rendered: HTMLElement,
        runs: BlankLineRun[],
        editorView: EditorView | null
    ) {
        const editorLine =
            this.sourceView.querySelector<HTMLElement>(".cm-line");
        const fallbackLineHeight = editorLine
            ? Number.parseFloat(computedStyle(editorLine)?.lineHeight ?? "")
            : 24;
        const doc = editorView?.state.doc;

        for (const run of runs) {
            const marker = rendered.querySelector<HTMLElement>(
                `.${run.markerClass}`
            );
            if (!marker) continue;

            let height = 0;
            if (editorView && doc) {
                for (const lineNumber of run.sourceLineNumbers) {
                    if (lineNumber > doc.lines) continue;
                    height += editorView.lineBlockAt(
                        doc.line(lineNumber).from
                    ).height;
                }
            } else {
                height =
                    run.sourceLineNumbers.length *
                    (Number.isFinite(fallbackLineHeight)
                        ? fallbackLineHeight
                        : 24);
            }
            marker.style.height = `${Math.max(0, height)}px`;
        }
    }

    // --- rendering --------------------------------------------------------

    /**
     * Source mode's minimap is the source text, one element per line, sized by
     * the same CSS variables Obsidian's own Source-mode styling resolves. No
     * Markdown renderer is involved, so nothing appears that the note does not
     * show, and blank lines and frontmatter need no special handling.
     */
    renderSourceText() {
        const file = this.view.file;
        if (!file || !this.content) return;

        const dom = buildSourceLineDom(this.getEditorView()?.state.doc.toString() ?? this.view.getViewData());
        this.renderComponent?.unload();
        this.renderComponent = null;

        this.content.empty();
        this.content.classList.add("source-minimap-content-source");
        this.addInlineTitle(file.basename);
        this.content.appendChild(dom.fragment);

        this.sourceLineElements = dom.elements;
        this.refreshSourceLayout();

        this.headingLines = dom.headingLines;
        this.headingLevels = dom.headingLevels;
        this.lineCount = dom.elements.length;
        this.afterRender();

        // Obsidian only loads Prism when it first renders a code block, so a
        // session spent in Source mode may not have it yet and the code above
        // will have drawn the note's code flat. Fetch it and draw once more.
        // The re-render finds Prism loaded, so this cannot repeat.
        if (dom.prismPending) {
            void warmPrism(this.plugin.app).then(() => {
                if (!this.content || !isPrismReady()) return;
                if (!this.isRawSourceMode()) return;
                this.renderSourceText();
            });
        }
    }

    private refreshSourceLayout() {
        applySourceFolds(this.sourceLineElements, this.getEditorView());
        this.sourceMap.capture(this.sourceLineElements);
    }

    scheduleSourceRender() {
        if (this.sourceRenderFrame || !this.content) return;
        this.sourceRenderFrame = this.element.ownerDocument.defaultView!.requestAnimationFrame(() => {
            this.sourceRenderFrame = 0;
            if (this.content && this.isRawSourceMode()) this.renderSourceText();
        });
    }

    // Render the note's full Markdown source into the scaled minimap panel.
    // Blank-line markers retain the source's vertical spacing without
    // replacing Obsidian's rendered Markdown output.
    async render() {
        const renderVersion = ++this.renderVersion;
        const file = this.view.file;
        if (!file || !this.content) return;

        if (this.isRawSourceMode()) {
            this.renderSourceText();
            return;
        }
        this.content.classList.remove("source-minimap-content-source");
        this.sourceLineElements = [];
        this.sourceMap.clear();
        this.sourceMapInUse = false;

        const data = prepareBlankLineRuns(this.view.getViewData());
        const editorView = this.getEditorView();

        const component = new Component();
        component.load();
        const rendered = activeDocument.createElement("div");
        try {
            await MarkdownRenderer.render(
                this.plugin.app,
                data.markdown,
                rendered,
                file.path,
                component
            );
        } catch {
            component.unload();
            return;
        }

        // A newer render started (or we were destroyed) while awaiting
        if (renderVersion !== this.renderVersion || !this.content) {
            component.unload();
            return;
        }

        // Reading view collapses consecutive blank lines, so reproducing them
        // there would add height the note does not have. Only the editing
        // modes actually show them.
        if (!this.isReadModeActive()) {
            this.applyBlankLineHeights(rendered, data.runs, editorView);
        }
        renderFrontmatter({
            rendered,
            element: this.element,
            readMode: this.isReadModeActive(),
            editorView,
            lineCount: data.frontmatterLineCount,
            paneMeasurable: this.isPaneMeasurable(),
            displayMode: this.getPropertiesDisplayMode(),
        });
        this.renderComponent?.unload();
        this.renderComponent = component;

        this.content.empty();
        this.addInlineTitle(file.basename);
        while (rendered.firstChild) {
            this.content.appendChild(rendered.firstChild);
        }

        this.applyHeadingIndex(data.headingLines, data.headingLevels);
        this.lineCount = data.lineCount;
        this.afterRender();
    }

    /**
     * Adopt the scanned heading index, or Obsidian's own if the scan and the
     * panel disagree about how many headings the note has.
     *
     * The pairing is by ordinal, so a disagreement means every ordinal is
     * suspect and both the folds and the anchors switch off for the whole note.
     * That cliff is the real cost of a missed heading, and the metadata cache
     * is a good second opinion precisely when the scanner has been surprised:
     * it is what Obsidian folds and outlines from. It lags the editor by a save
     * though, so it is checked against the live text before it is trusted, and
     * only used when it resolves the disagreement rather than merely differing.
     * Issue #13.
     */
    private applyHeadingIndex(lines: number[], levels: number[]) {
        this.headingLines = lines;
        this.headingLevels = levels;

        const rendered = collectRenderedHeadings(this.content).length;
        if (rendered === lines.length) return;

        const cached = readCachedHeadings(
            this.plugin.app,
            this.view.file,
            this.view.getViewData()
        );
        if (!cached || cached.lines.length !== rendered) return;

        this.headingLines = cached.lines;
        this.headingLevels = cached.levels;
    }

    private addInlineTitle(basename: string) {
        const inlineTitle = findInlineTitle(
            this.element,
            this.isReadModeActive()
        );
        if (!this.content || !inlineTitle || inlineTitle.offsetHeight <= 0)
            return;
        this.content.createDiv({
            cls: "inline-title source-minimap-inline-title",
            text: basename,
        });
    }

    private afterRender() {
        this.syncDocumentMetrics();
        // A re-render rebuilds the panel from the full note, so the note's
        // collapsed sections have to be folded back out of it before anything
        // measures the result.
        const foldHeads = readFoldHeads(this.view);
        this.foldSignature = this.isRawSourceMode()
            ? sourceFoldSignature(this.getEditorView()) : foldHeads.join(",");
        if (this.isRawSourceMode()) this.refreshSourceLayout();
        this.applyFolds(foldHeads);
        this.anchors.capture(
            this.content,
            this.headingLines,
            this.scale,
            this.hiddenHeadings
        );
        this.updateSliderScroll();
        void this.onResize();
    }

    // --- scroll sync ------------------------------------------------------

    // CodeMirror's scrollHeight is an estimate that settles shortly after a
    // jump, so re-sync once more after scrolling stops.
    onScroll = () => {
        this.updateSliderScroll();
        window.clearTimeout(this.trailingSyncTimer);
        this.trailingSyncTimer = window.setTimeout(this.settleAfterScroll, 350);
    };

    // Source layout stays fixed during scrolling. Only navigation consults
    // CodeMirror's changing height estimates; they never resize panel rows.
    settleAfterScroll = () => {
        this.checkFolds();
        this.updateSliderScroll();
    };

    async onResize() {
        window.clearTimeout(this.resizeTimer);
        this.resizeTimer = window.setTimeout(() => {
            this.remeasure();
            window.clearTimeout(this.resizeSettleTimer);
            this.resizeSettleTimer = window.setTimeout(this.remeasure, 400);
        }, 100);
    }

    /** One full measuring pass over the note's layout. */
    private remeasure = () => {
        if (!this.content) return;
        this.syncDocumentMetrics();
        if (this.isRawSourceMode()) this.refreshSourceLayout();
        // Fold the panel before it is measured, not after. Direct rather than
        // via checkFolds, which would call back into here.
        this.syncFoldState();
        // Layout may have shifted every heading, so re-measure the anchors
        // before they are used to place the slider.
        this.anchors.capture(
            this.content,
            this.headingLines,
            this.scale,
            this.hiddenHeadings
        );
        // Sync now and once more after CodeMirror's height estimate settles.
        this.onScroll();
    };

    /**
     * `scrollTopOverride` asks "what would the geometry be if we scrolled
     * there", which the pointer needs because the panel pans with the scroll
     * position. Everything else it reads — the anchors, the content offset —
     * is independent of where the editor currently sits.
     */
    getScrollMetrics(scrollTopOverride?: number): ScrollMetrics {
        const scroller = this.scroller;
        const clientHeight = Math.max(scroller?.clientHeight ?? 1, 1);
        const scrollHeight = Math.max(
            scroller?.scrollHeight ?? clientHeight,
            clientHeight
        );
        const heights = resolveDocumentHeights(
            clientHeight,
            scrollHeight,
            this.content?.scrollHeight ?? 0
        );

        this.anchors.revalidate(heights.contentHeight);
        // Reading view virtualizes its sections, so anchors never apply there.
        const usable =
            !this.isReadModeActive() && !this.isRawSourceMode() &&
            this.anchors.prepare(
                this.getEditorView(),
                this.getEditorContentOffset(),
                heights.effectiveScrollHeight,
                heights.contentHeight
            );
        this.anchorsInUse = usable;
        const editor = this.getEditorView();
        // documentTop excludes CM's top padding, unlike contentDOM's rect.
        const sourceOffset = editor && scroller
            ? editor.documentTop - scroller.getBoundingClientRect().top + scroller.scrollTop : 0;
        this.sourceMapInUse = this.isRawSourceMode() && this.sourceMap.prepare(
            editor, sourceOffset, heights.effectiveScrollHeight, heights.contentHeight
        );

        return computeScrollMetrics({
            clientHeight,
            scrollHeight,
            scrollTop: scrollTopOverride ?? scroller?.scrollTop ?? 0,
            containerHeight: this.container?.clientHeight ?? 0,
            topOffset: this.topOffset || 0,
            bottomOffset: this.bottomOffset || 0,
            effectiveScrollHeight: heights.effectiveScrollHeight,
            contentHeight: heights.contentHeight,
            scale: this.scale,
            minViewportHeight: this.minViewportHeight,
            mapToMinimap: this.sourceMapInUse ? this.sourceMap.toMinimap
                : usable ? this.anchors.toMinimap : null,
        });
    }

    updateSliderScroll = () => {
        if (
            !this.container ||
            !this.viewport ||
            !this.content ||
            !this.slider ||
            !this.hitbox
        )
            return;
        this.syncScroller();
        if (!this.scroller) return;
        // A hidden pane measures 0 everywhere; keep the last geometry and
        // re-sync once the pane becomes visible again.
        if (!this.scroller.isConnected || this.scroller.clientHeight === 0)
            return;
        // Cheap until it succeeds, then a no-op: picks up the editor's code
        // metrics as soon as a code block scrolls into the rendered window,
        // instead of leaving them unmirrored until the next resize.
        if (!this.codeMetricsMirrored) this.syncCodeBlockMetrics();

        const metrics = this.getScrollMetrics();
        const sliderTop =
            (this.topOffset || 0) +
            clamp(
                metrics.mappedTop - metrics.minimapScrollOffset,
                0,
                Math.max(0, metrics.activeHeight - metrics.sliderHeight)
            );

        this.viewport.style.top = `${
            (this.topOffset || 0) - metrics.minimapScrollOffset
        }px`;
        this.slider.style.top = `${sliderTop}px`;
        this.slider.style.height = `${metrics.sliderHeight}px`;
        this.hitbox.style.height = `${metrics.activeHeight}px`;
    };

    // --- PointerHost ------------------------------------------------------

    getScroller() {
        this.syncScroller();
        return this.scroller;
    }

    /**
     * Answers with the same mapping that placed the thumb, or null so the
     * caller falls back to the global ratio.
     *
     * Asking whether anchors merely exist is not the same question. The panel
     * still has headings to anchor to in reading view, but the thumb is placed
     * by the global ratio there because reading view virtualizes its sections —
     * and the anchors are never prepared, so their document extent stays zero
     * and every position maps to the top of the note. Clicking the minimap in
     * reading view therefore jumped to the top, and dragging fought the thumb.
     */
    mapToEditor(minimapY: number): number | null {
        return this.sourceMapInUse ? this.sourceMap.toEditor(minimapY)
            : this.anchorsInUse ? this.anchors.toEditor(minimapY) : null;
    }

    onScrolled() {
        this.updateSliderScroll();
    }
}
