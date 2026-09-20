import type { MarkdownView } from "obsidian";
import { collectRenderedHeadings } from "./anchors";

/**
 * Mirroring the note's collapsed sections onto the panel.
 *
 * A folded section takes no room in the note, so drawing it in the minimap adds
 * height the note does not have: everything below the fold sits lower in the
 * panel than in the editor, and the thumb drifts by exactly that much.
 *
 * Obsidian keeps its fold state per view, in source lines, and reports it the
 * same way in every mode. Working from source lines is what makes this work in
 * reading view at all — the panel is not virtualized, so it can be folded
 * accurately even where the note's own rendered sections are missing from the
 * DOM.
 */

/** A folded span of the note, in 1-based source lines. */
export interface FoldRange {
    /** The heading line, which stays visible. */
    fromLine: number;
    /** Last line hidden by the fold, inclusive. */
    toLine: number;
}

/** Obsidian's fold state. Undocumented, so every access is defensive. */
type FoldInfo = { folds?: { from?: number; to?: number }[] } | null;

interface FoldCapableMode {
    getFoldInfo?: () => FoldInfo;
}

/**
 * Source lines of the note's fold heads, 1-based and ascending.
 *
 * Only the head is taken. The reported extent is the editor's in the editing
 * modes but collapses to a single line in reading view, so trusting it would
 * fold the panel by one line there while the note folds a whole section.
 */
export function readFoldHeads(this: void, view: MarkdownView): number[] {
    const mode = view.currentMode as unknown as FoldCapableMode | null;
    // Annotated rather than left to evolve: an unannotated `let` is `any` until
    // it is assigned, which makes everything read out of it `any` as well.
    let info: FoldInfo | undefined;
    try {
        info = mode?.getFoldInfo?.();
    } catch {
        return [];
    }
    const folds = info?.folds;
    if (!Array.isArray(folds)) return [];

    const heads: number[] = [];
    for (const fold of folds) {
        const from = fold?.from;
        if (typeof from !== "number" || !Number.isFinite(from)) continue;
        heads.push(from + 1);
    }
    return heads.sort((a, b) => a - b);
}

/**
 * Turn fold heads into the spans they actually cover.
 *
 * A folded heading reaches to just before the next heading of the same level or
 * higher, which is a property of the document rather than of the fold, so it is
 * derived here instead of taken from Obsidian's report.
 *
 * Folds whose head is not a heading — a list item, a fenced block — are left
 * out. The panel can only locate headings, and Source mode does not need this
 * path at all: it takes every line's height from CodeMirror, which has already
 * collapsed them.
 */
export function resolveFoldRanges(
    this: void,
    foldHeads: number[],
    headingLines: number[],
    headingLevels: number[],
    lineCount: number
): FoldRange[] {
    if (foldHeads.length === 0 || headingLines.length === 0) return [];

    const ordinalOf = new Map<number, number>();
    for (let index = 0; index < headingLines.length; index++) {
        ordinalOf.set(headingLines[index], index);
    }

    const ranges: FoldRange[] = [];
    for (const head of foldHeads) {
        const index = ordinalOf.get(head);
        if (index === undefined) continue;

        const level = headingLevels[index];
        let toLine = lineCount;
        for (let next = index + 1; next < headingLines.length; next++) {
            if (headingLevels[next] <= level) {
                toLine = headingLines[next] - 1;
                break;
            }
        }
        if (toLine > head) ranges.push({ fromLine: head, toLine });
    }
    return ranges;
}

const HIDDEN_CLASS = "minimap-folded";

/**
 * Hide the panel blocks covered by each fold.
 *
 * The fold's own heading stays, as it does in the note. It keeps its rendered
 * margins where the editor gives it a single line block, so a run of folded
 * headings leaves the panel a little taller than the note over that stretch.
 * Matching it would mean resizing the heading from CodeMirror's idea of where
 * those lines are — and for anything outside its rendered window that is a flat
 * 24px estimate, which asks for a heading squashed to nothing on the strength of
 * a number the editor has not actually measured. The anchors pin every visible
 * heading either way, so the cost of leaving it is a thumb that changes size
 * slightly while it crosses several adjacent folds, not a position that drifts.
 *
 * Returns the heading ordinals that ended up hidden, which the anchors need in
 * order to drop them from the pairing rather than measure a zero rect.
 */
export function applyFoldsToPanel(
    this: void,
    content: HTMLElement | null,
    headingLines: number[],
    ranges: FoldRange[]
): Set<number> {
    const hidden = new Set<number>();
    if (!content) return hidden;

    content
        .querySelectorAll(`.${HIDDEN_CLASS}`)
        .forEach((node) => node.classList.remove(HIDDEN_CLASS));
    if (ranges.length === 0) return hidden;

    const rendered = collectRenderedHeadings(content);
    // The same pairing the anchors rely on. If the two lists disagree the
    // ordinals mean nothing, and folding the wrong blocks is worse than folding
    // none of them.
    if (rendered.length !== headingLines.length) return hidden;

    for (const range of ranges) {
        const index = headingLines.indexOf(range.fromLine);
        if (index < 0) continue;

        let after = headingLines.length;
        for (let next = index + 1; next < headingLines.length; next++) {
            if (headingLines[next] > range.toLine) {
                after = next;
                break;
            }
        }

        // Both lists hold only direct children of the panel, so the fold's
        // heading and the first block past it are siblings and everything
        // between them is the section.
        const start = rendered[index];
        const end = after < rendered.length ? rendered[after] : null;
        if (!start) continue;

        for (
            let node = start.nextElementSibling;
            node && node !== end;
            node = node.nextElementSibling
        ) {
            node.classList.add(HIDDEN_CLASS);
        }
        for (let ordinal = index + 1; ordinal < after; ordinal++) {
            hidden.add(ordinal);
        }
    }

    return hidden;
}
