import type { EditorView } from "@codemirror/view";
import { getFrontmatterLineCount, getProtectedLines } from "./blank-lines";
import { collectHeadings } from "./anchors";

/**
 * Source mode prints the file verbatim, so the minimap does too.
 *
 * Running the Markdown renderer there produced lists, tables, callouts and
 * images the note never shows, which both looked wrong and inflated every
 * mapped position. One element per source line is simpler and exact: no
 * blank-line spacers and no frontmatter special case, because in Source mode a
 * blank line really is a line and frontmatter really is text.
 */

export type SourceLineKind = "text" | "heading" | "code" | "frontmatter";

export interface SourceLine {
    text: string;
    kind: SourceLineKind;
    /** Heading level 1-6, or 0 for every other kind. */
    level: number;
}

const BLOCKQUOTE_PREFIX = /^ {0,3}> ?/;

function headingLevel(this: void, line: string): number {
    let text = line;
    while (BLOCKQUOTE_PREFIX.test(text)) {
        text = text.replace(BLOCKQUOTE_PREFIX, "");
    }
    const match = text.match(/^ {0,3}(#{1,6})(?:\s|$)/);
    return match ? match[1].length : 1;
}

export function classifySourceLines(
    this: void,
    markdown: string
): SourceLine[] {
    const lines = markdown.split(/\r?\n/);
    const protectedLines = getProtectedLines(lines);
    const frontmatterLines = getFrontmatterLineCount(lines);
    const headings = new Set(collectHeadings(lines, protectedLines).lines);

    return lines.map((text, index) => {
        const lineNumber = index + 1;
        if (lineNumber <= frontmatterLines) {
            return { text, kind: "frontmatter", level: 0 };
        }
        if (protectedLines[index]) {
            return { text, kind: "code", level: 0 };
        }
        if (headings.has(lineNumber)) {
            return { text, kind: "heading", level: headingLevel(text) };
        }
        return { text, kind: "text", level: 0 };
    });
}

/**
 * Source mode is not plain text in the editor: CodeMirror still highlights it,
 * so links, tags, code and headings all carry their theme colour. At minimap
 * scale the words are unreadable and that colour is the only thing left telling
 * one part of the note from another, which is why reproducing it matters more
 * here than at full size.
 *
 * Matched in one pass so earlier alternatives win: a `**bold**` run inside a
 * code span stays code, as it does in the editor.
 *
 * No lookbehind anywhere in here. iOS did not support them until 16.4, and this
 * is built once at module scope, so a lookbehind would not merely fail to match
 * on an older iPhone — it would throw while the module was still loading and
 * take the whole plugin down with it. A tag therefore swallows the whitespace
 * in front of it and `fillLine` hands that character back.
 */
const INLINE_TOKEN = new RegExp(
    [
        "(?<code>`[^`\\n]+`)",
        "(?<embed>!?\\[\\[[^\\]\\n]*\\]\\])",
        "(?<link>!?\\[[^\\]\\n]*\\]\\([^)\\n]*\\))",
        "(?<url>https?:\\/\\/[^\\s)]+)",
        "(?<strong>\\*\\*[^\\n]+?\\*\\*|__[^\\n]+?__)",
        "(?<em>\\*[^*\\n]+?\\*|_[^_\\n]+?_)",
        "(?<highlight>==[^\\n]+?==)",
        "(?<strike>~~[^\\n]+?~~)",
        "(?<tag>(?:^|\\s)#[\\p{L}\\p{N}/_-]+)",
    ].join("|"),
    "gu"
);

const TOKEN_CLASS: Record<string, string> = {
    code: "minimap-source-code-span",
    embed: "minimap-source-link",
    link: "minimap-source-link",
    url: "minimap-source-link",
    strong: "minimap-source-strong",
    em: "minimap-source-em",
    highlight: "minimap-source-highlight",
    strike: "minimap-source-strike",
    tag: "minimap-source-tag",
};

const QUOTE_LINE = /^ {0,3}(?:> ?)+/;
const LIST_MARKER = /^(\s*)([-*+]|\d+[.)])(\s+(?:\[[ xX/-]\]\s+)?)/;

function appendToken(
    this: void,
    parent: HTMLElement,
    text: string,
    cls?: string
) {
    if (!text) return;
    if (!cls) {
        parent.appendChild(activeDocument.createTextNode(text));
        return;
    }
    const span = activeDocument.createElement("span");
    span.className = cls;
    span.textContent = text;
    parent.appendChild(span);
}

/**
 * Fill a line element with the source text, wrapping the parts the editor
 * colours in spans. Falls back to a single text node when there is nothing to
 * mark, which is most lines.
 */
function fillLine(this: void, element: HTMLElement, text: string) {
    if (text.length === 0) {
        // An empty div collapses to nothing; a zero-width space keeps the line
        // box so blank lines occupy their line, as they do in Source.
        element.textContent = "​";
        return;
    }

    let rest = text;
    const quote = rest.match(QUOTE_LINE);
    if (quote) {
        element.classList.add("mod-quote");
        appendToken(element, quote[0], "minimap-source-marker");
        rest = rest.slice(quote[0].length);
    }
    const marker = rest.match(LIST_MARKER);
    if (marker) {
        appendToken(element, marker[1]);
        appendToken(
            element,
            marker[2] + marker[3],
            "minimap-source-marker"
        );
        rest = rest.slice(marker[0].length);
    }

    INLINE_TOKEN.lastIndex = 0;
    let index = 0;
    let match: RegExpExecArray | null;
    while ((match = INLINE_TOKEN.exec(rest)) !== null) {
        appendToken(element, rest.slice(index, match.index));
        const groups = match.groups ?? {};
        const name = Object.keys(groups).find(
            (key) => groups[key] !== undefined
        );
        // The tag alternative matches the separator in front of the hash to
        // stand in for the lookbehind it cannot use; that character belongs to
        // the line, not to the tag.
        let token = match[0];
        if (name === "tag") {
            const lead = /^\s/.exec(token)?.[0];
            if (lead) {
                appendToken(element, lead);
                token = token.slice(lead.length);
            }
        }
        appendToken(element, token, name ? TOKEN_CLASS[name] : undefined);
        index = match.index + match[0].length;
    }
    appendToken(element, rest.slice(index));
}

export interface SourceLineDom {
    fragment: DocumentFragment;
    /** One element per source line, index 0 being line 1. */
    elements: HTMLElement[];
    /** Source line numbers of the headings, for anchor pairing. */
    headingLines: number[];
    /** Heading levels, parallel to `headingLines`, for resolving fold extents. */
    headingLevels: number[];
}

export function buildSourceLineDom(
    this: void,
    markdown: string
): SourceLineDom {
    const lines = classifySourceLines(markdown);
    const headingLines: number[] = [];
    const headingLevels: number[] = [];
    const elements: HTMLElement[] = [];
    const fragment = activeDocument.createDocumentFragment();

    lines.forEach((line, index) => {
        const element = activeDocument.createElement("div");
        element.className = "minimap-source-line";
        if (line.kind === "heading") {
            element.classList.add(
                "minimap-source-heading",
                `mod-h${line.level}`
            );
            headingLines.push(index + 1);
            headingLevels.push(line.level);
        } else if (line.kind === "code") {
            element.classList.add("mod-code");
        } else if (line.kind === "frontmatter") {
            element.classList.add("mod-frontmatter");
        }
        // Code and frontmatter are literal in the editor too, so nothing inside
        // them is markup to colour.
        if (line.kind === "code" || line.kind === "frontmatter") {
            element.textContent =
                line.text.length > 0 ? line.text : "\u200B";
        } else {
            fillLine(element, line.text);
        }
        elements.push(element);
        fragment.appendChild(element);
    });

    return { fragment, elements, headingLines, headingLevels };
}

/**
 * Take each line's height from CodeMirror rather than trying to reproduce it.
 * The editor adds per-line padding and inline formatting spans that vary by
 * theme and line type, and its heightmap is in any case the authority for the
 * scroll space, so copying it is both exact and immune to theme styling.
 *
 * Returns the CodeMirror content height the copy was taken from, or null when
 * nothing was applied.
 */
export function applySourceLineHeights(
    this: void,
    elements: HTMLElement[],
    editorView: EditorView | null,
    appliedContentHeight: number
): number | null {
    const doc = editorView?.state.doc;
    if (!editorView || !doc) return null;
    // CodeMirror swaps estimates for measurements as lines are rendered, which
    // moves heights underneath us. Its total is a cheap signal that something
    // changed, so the full walk only runs when it has.
    if (editorView.contentHeight === appliedContentHeight) return null;

    for (let index = 0; index < elements.length; index++) {
        const lineNumber = index + 1;
        if (lineNumber > doc.lines) break;
        const block = editorView.lineBlockAt(doc.line(lineNumber).from);
        // A fold merges its lines into a single block, and every line inside it
        // reports that block's whole height. Giving each of them the full value
        // made a folded section taller in the panel than it had been unfolded,
        // so the height goes to the line the block starts on and the rest
        // collapse — which is what the editor shows.
        const first = doc.lineAt(block.from).number;
        const height = lineNumber === first ? block.height : 0;
        elements[index].style.height = `${Math.max(0, height)}px`;
    }

    return editorView.contentHeight;
}
