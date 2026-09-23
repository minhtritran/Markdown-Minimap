import { clamp, computedStyle, pixels } from "./utils";

/**
 * Measuring the note's own layout and mirroring it onto the panel.
 *
 * The minimap is only a faithful map if it wraps where the note wraps, so
 * width, margins, typography and code-block geometry are all read from the
 * live editor rather than assumed.
 */

export interface DocumentElements {
    scroller: HTMLElement | null;
    sizer: HTMLElement | null;
    text: HTMLElement | null;
}

/**
 * The elements that define the note's layout in the active mode: the scroller
 * supplies the file margins, the sizer the text width, and the text element the
 * typography.
 */
export function resolveDocumentElements(
    this: void,
    element: HTMLElement,
    readMode: boolean
): DocumentElements {
    const scope = readMode
        ? ".markdown-reading-view"
        : ".markdown-source-view";
    const sizer = element.querySelector<HTMLElement>(
        readMode ? `${scope} .markdown-preview-sizer` : `${scope} .cm-sizer`
    );
    return {
        scroller: element.querySelector<HTMLElement>(
            readMode ? `${scope} .markdown-preview-view` : `${scope} .cm-scroller`
        ),
        sizer,
        text: readMode
            ? sizer
            : element.querySelector<HTMLElement>(`${scope} .cm-content`),
    };
}

/** Space below the last line that exists only so you can scroll past the end. */
export function measureTrailingPadding(
    this: void,
    element: HTMLElement,
    readMode: boolean,
    scroller: HTMLElement | null
): number {
    const inner = readMode
        ? scroller?.querySelector<HTMLElement>(".markdown-preview-sizer")
        : element.querySelector<HTMLElement>(
              ".markdown-source-view .cm-content"
          );
    if (!inner) return 0;
    return pixels(computedStyle(inner)?.paddingBottom);
}

export interface MirrorOptions {
    element: HTMLElement;
    container: HTMLElement;
    content: HTMLElement;
    readMode: boolean;
    rawSourceMode: boolean;
    hitbox: HTMLElement | null;
    refreshPadding?: boolean;
}

/** Pixels needed to keep the editor inside the measured strip boundary. */
export function requiredEditorPadding(innerRight: number, stripLeft: number, themePadding: number): number {
    return Math.ceil(Math.max(themePadding, innerRight - stripLeft + 12));
}

/** Keep the established wrapping width during edits; only layout changes remeasure it. */
export function syncTextWidth(container: HTMLElement, measure: () => number, refresh: boolean): void {
    const current = pixels(container.style.getPropertyValue("--source-minimap-doc-width"));
    if (!refresh && current > 0) return;
    const width = measure();
    if (width > 0 && width !== current) {
        container.style.setProperty("--source-minimap-doc-width", `${width}px`);
    }
}

/** Width inside an element's own padding, which is where its text wraps. */
function innerWidth(this: void, element: HTMLElement | null): number {
    if (!element) return 0;
    const style = computedStyle(element);
    return (
        element.clientWidth -
        pixels(style?.paddingLeft) -
        pixels(style?.paddingRight)
    );
}

/**
 * The width the note's lines actually wrap at.
 *
 * Read from a rendered line rather than from the sizer. Obsidian's own styling
 * applies readable line length to the sizer, so on the default theme the two
 * agree — but a theme is free to leave the sizer at the pane's full width and
 * constrain the blocks inside it instead, which is what Minimal does. Trusting
 * the sizer there laid the panel out at nearly twice the note's width, so it
 * wrapped in different places and stopped being a map of the page.
 *
 * Code lines carry their own inset, and the header and pusher are not text, so
 * none of them speak for the note's width.
 */
function measureTextWidth(
    this: void,
    element: HTMLElement,
    readMode: boolean,
    sizer: HTMLElement | null
): number {
    if (readMode) {
        for (const child of Array.from(sizer?.children ?? [])) {
            if (
                child.classList.contains("markdown-preview-pusher") ||
                child.classList.contains("mod-header") ||
                child.classList.contains("mod-footer")
            ) {
                continue;
            }
            const width = innerWidth(child as HTMLElement);
            if (width > 0) return width;
        }
    } else {
        const line = element.querySelector<HTMLElement>(
            ".markdown-source-view .cm-line:not(.HyperMD-codeblock)"
        );
        const width = innerWidth(line);
        if (width > 0) return width;
    }
    // An empty note, or one with nothing but code in it, still needs a width.
    return innerWidth(sizer);
}

/**
 * The panel's counterpart to the contentless space below the note's last line —
 * the file margin plus the room Obsidian leaves for scrolling past the end.
 *
 * Copying those pixels across verbatim looks right and is not: the panel does
 * not lay content out at the same height the note does, so a verbatim margin is
 * the one stretch of the panel drawn at a different scale from everything above
 * it. The thumb changes size as it crosses into it — growing where the panel
 * runs shorter than the note, shrinking where it runs taller — over the last
 * viewport-height of the scroll, which is where it is most visible.
 *
 * Scaling it by the ratio the panel actually achieves makes the whole panel one
 * consistent picture of the note, so the thumb keeps its size to the bottom.
 * The ratio is bounded because a pane mid-layout can report nonsense, and an
 * absurd margin is worse than a verbatim one.
 */
function scaleTrailingSpace(
    this: void,
    content: HTMLElement,
    scroller: HTMLElement | null,
    editorTrailing: number
): number {
    if (editorTrailing <= 0 || !scroller) return Math.max(0, editorTrailing);

    const applied = pixels(computedStyle(content)?.paddingBottom);
    const panelContent = content.scrollHeight - applied;
    const editorContent = scroller.scrollHeight - editorTrailing;
    if (panelContent <= 0 || editorContent <= 0) return editorTrailing;

    return editorTrailing * clamp(panelContent / editorContent, 0.25, 4);
}

/**
 * Rendering at the pane's full width made lines wrap at different points than
 * the note itself, so the panel takes the note's width, margins and typography.
 */
export function mirrorDocumentMetrics(
    this: void,
    options: MirrorOptions
): void {
    const { element, container, content, readMode, rawSourceMode } = options;
    const { scroller, sizer, text } = resolveDocumentElements(
        element,
        readMode
    );

    // Match the user's working scroller padding + border-box rule. Never
    // resize the source-view wrapper, shift margins, or clip the gutter.
    if (!readMode && scroller && scroller.clientWidth === 0) return;
    const refreshPadding = options.refreshPadding !== false || readMode ||
        !element.classList.contains("source-minimap-auto-padding");
    if (refreshPadding) {
        element.classList.remove("source-minimap-auto-padding");
        element.style.removeProperty("--source-minimap-editor-right-padding");
    }
    if (refreshPadding && !readMode && scroller && options.hitbox) {
        const themePadding = pixels(computedStyle(scroller)?.paddingRight);
        const measureStrip = () => {
            const width = measureTextWidth(element, false, sizer);
            if (width > 0) container.style.setProperty("--source-minimap-doc-width", `${width}px`);
            const strip = options.hitbox!.getBoundingClientRect();
            return strip.width > 0 ? requiredEditorPadding(
                scroller.getBoundingClientRect().left + scroller.clientWidth,
                strip.left, themePadding
            ) : themePadding;
        };
        let padding = measureStrip();
        element.classList.add("source-minimap-auto-padding");
        // Padding changes wrapping width, which changes the scaled strip.
        // A bounded feedback pass avoids retaining the full unpadded width.
        for (let pass = 0; pass < 4; pass++) {
            element.style.setProperty("--source-minimap-editor-right-padding", `${padding}px`);
            const next = measureStrip();
            if (next === padding) break;
            // End on the conservative side of any rounding oscillation.
            padding = pass === 3 ? Math.max(padding, next) : next;
        }
        element.style.setProperty("--source-minimap-editor-right-padding", `${padding}px`);
    }

    syncTextWidth(container, () => measureTextWidth(element, readMode, sizer), refreshPadding);

    // Bind the track to the editor's visible height. Left to `height: 100%` it
    // resolves against a taller ancestor, putting the end of the track below
    // the window where the pointer cannot reach it.
    if (scroller && scroller.clientHeight > 0) {
        container.style.setProperty(
            "--source-minimap-track-height",
            `${scroller.clientHeight}px`
        );
    }

    const paddingTop =
        pixels(computedStyle(scroller)?.paddingTop) +
        pixels(computedStyle(sizer)?.paddingTop);
    container.style.setProperty("--source-minimap-doc-padding-top", `${paddingTop}px`);
    // The file margin below the last line, and the room Obsidian leaves for
    // scrolling past the end, are both part of the scroll range the thumb
    // travels. The panel needs its own counterpart rather than the mapping
    // pretending they are not there.
    const editorTrailing =
        pixels(computedStyle(scroller)?.paddingBottom) +
        measureTrailingPadding(element, readMode, scroller);
    container.style.setProperty(
        "--source-minimap-doc-trailing",
        `${scaleTrailingSpace(content, scroller, editorTrailing)}px`
    );

    // Themes commonly scope line height to selectors the panel does not match,
    // so mirror the resolved values instead of relying on class inheritance.
    const textStyle = computedStyle(text);
    const lineHeight = Number.parseFloat(textStyle?.lineHeight ?? "");
    const fontSize = Number.parseFloat(textStyle?.fontSize ?? "");
    content.style.lineHeight = Number.isFinite(lineHeight)
        ? `${lineHeight}px`
        : "";
    content.style.fontSize = Number.isFinite(fontSize) ? `${fontSize}px` : "";
    // Source mode reproduces the editor's own text, so it must use the editor's
    // font rather than the one rendered Markdown would pick.
    content.style.fontFamily = rawSourceMode
        ? textStyle?.fontFamily ?? ""
        : "";
    content.style.tabSize = rawSourceMode ? textStyle?.tabSize ?? "4" : "";
    content.style.letterSpacing = rawSourceMode ? textStyle?.letterSpacing ?? "" : "";
    const line = rawSourceMode ? element.querySelector<HTMLElement>(
        ".markdown-source-view .cm-line:not(.HyperMD-codeblock)"
    ) : null;
    const lineStyle = computedStyle(line) ?? textStyle;
    for (const property of ["white-space", "overflow-wrap", "word-break"] as const) {
        const value = rawSourceMode ? lineStyle?.getPropertyValue(property) : "";
        container.style.setProperty(`--source-minimap-source-${property}`, value || "initial");
    }
}

/**
 * Rendered code blocks and Live Preview's code lines do not agree: the rendered
 * <pre> is inset on both sides and uses the body line height, while a code line
 * is inset only on the left and uses the code line height. The stylesheet
 * already covers the common case; this refines it for themes that differ.
 *
 * Returns whether a measurement was taken, so the caller can stop retrying.
 */
export function mirrorCodeMetrics(
    this: void,
    sourceView: HTMLElement,
    container: HTMLElement,
    content: HTMLElement
): boolean {
    // Code lines only exist while a block is inside CodeMirror's rendered
    // window, so this may legitimately find nothing and be retried later.
    const codeLine = sourceView.querySelector<HTMLElement>(
        ".cm-line.HyperMD-codeblock"
    );
    if (!codeLine || codeLine.clientWidth <= 0) return false;

    const style = computedStyle(codeLine);
    const paddingLeft = pixels(style?.paddingLeft);
    const innerWidth =
        codeLine.clientWidth - paddingLeft - pixels(style?.paddingRight);
    if (innerWidth <= 0) return false;

    const paddingRight = Math.max(
        0,
        content.clientWidth - innerWidth - paddingLeft
    );
    container.style.setProperty(
        "--source-minimap-code-padding-left",
        `${paddingLeft}px`
    );
    container.style.setProperty(
        "--source-minimap-code-padding-right",
        `${paddingRight}px`
    );
    const codeLineHeight = Number.parseFloat(style?.lineHeight ?? "");
    container.style.setProperty(
        "--source-minimap-code-line-height",
        Number.isFinite(codeLineHeight) ? `${codeLineHeight}px` : "normal"
    );
    const codeFontSize = Number.parseFloat(style?.fontSize ?? "");
    if (Number.isFinite(codeFontSize)) {
        container.style.setProperty(
            "--source-minimap-code-font-size",
            `${codeFontSize}px`
        );
    }
    content.classList.add("source-minimap-mirror-code");
    return true;
}
