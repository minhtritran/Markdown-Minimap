import type { EditorView } from "@codemirror/view";
import { clamp } from "./utils";

function between(value: number, from: number, to: number, low: number, high: number) {
    return low + clamp((value - from) / Math.max(0.001, to - from), 0, 1) * (high - low);
}

/** Stable panel geometry; editor heights are consulted only for navigation.
 * Scrolling must never rewrite the panel's line heights with CM estimates.
 */
export class SourceMap {
    private rows: { line: number; top: number; bottom: number }[] = [];
    private editor: EditorView | null = null;
    private offset = 0;
    private editorHeight = 0;
    private panelHeight = 0;

    capture(elements: HTMLElement[]) {
        this.rows = elements.flatMap((element, index) =>
            element.offsetHeight > 0
                ? [{ line: index + 1, top: element.offsetTop,
                     bottom: element.offsetTop + element.offsetHeight }]
                : []
        );
    }

    clear() { this.rows = []; this.editor = null; }

    prepare(editor: EditorView | null, offset: number, editorHeight: number, panelHeight: number) {
        this.editor = editor;
        this.offset = offset;
        this.editorHeight = editorHeight;
        this.panelHeight = panelHeight;
        return !!editor && this.rows.length > 0 &&
            this.rows[this.rows.length - 1].line <= editor.state.doc.lines;
    }

    private rowAt(value: number, key: "line" | "top") {
        let low = 0, high = this.rows.length;
        while (low < high) {
            const middle = (low + high) >>> 1;
            if (this.rows[middle][key] <= value) low = middle + 1;
            else high = middle;
        }
        return this.rows[Math.max(0, low - 1)];
    }

    private block(row: { line: number }) {
        return this.editor!.lineBlockAt(this.editor!.state.doc.line(row.line).from);
    }

    toMinimap = (y: number): number => {
        if (!this.editor || !this.rows.length) return y;
        const first = this.rows[0], last = this.rows[this.rows.length - 1];
        const start = this.offset + this.block(first).top;
        const end = this.offset + this.block(last).bottom;
        if (y <= start) return between(y, 0, start, 0, first.top);
        if (y >= end) return between(y, end, this.editorHeight, last.bottom, this.panelHeight);
        const block = this.editor.lineBlockAtHeight(Math.max(0, y - this.offset));
        const row = this.rowAt(this.editor.state.doc.lineAt(block.from).number, "line");
        return between(y, this.offset + block.top, this.offset + block.bottom, row.top, row.bottom);
    };

    toEditor = (y: number): number => {
        if (!this.editor || !this.rows.length) return y;
        const first = this.rows[0], last = this.rows[this.rows.length - 1];
        if (y <= first.top) return between(y, 0, first.top, 0, this.offset + this.block(first).top);
        if (y >= last.bottom) return between(y, last.bottom, this.panelHeight,
            this.offset + this.block(last).bottom, this.editorHeight);
        const row = this.rowAt(y, "top"), block = this.block(row);
        return between(y, row.top, row.bottom, this.offset + block.top, this.offset + block.bottom);
    };
}
