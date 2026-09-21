import type { EditorView } from "@codemirror/view";
import { foldedRanges } from "@codemirror/language";
import {
    getFencedCodeBlocks,
    getFrontmatterLineCount,
    getProtectedLines,
} from "./blank-lines";
import { collectHeadings } from "./anchors";
import { highlightCode, isPrismReady, type CodeRun } from "./prism";

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

export function classifySourceLines(
    this: void,
    markdown: string
): SourceLine[] {
    const lines = markdown.split(/\r?\n/);
    const protectedLines = getProtectedLines(lines);
    const frontmatterLines = getFrontmatterLineCount(lines);
    // Levels come from the same pass that found the headings rather than being
    // read back off the text. A setext heading carries no `#` to read, so
    // re-deriving the level landed every one of them on h1.
    const index = collectHeadings(lines, protectedLines);
    const headingLevelOf = new Map<number, number>();
    index.lines.forEach((line, ordinal) => {
        headingLevelOf.set(line, index.levels[ordinal]);
    });

    return lines.map((text, lineIndex) => {
        const lineNumber = lineIndex + 1;
        if (lineNumber <= frontmatterLines) {
            return { text, kind: "frontmatter", level: 0 };
        }
        if (protectedLines[lineIndex]) {
            return { text, kind: "code", level: 0 };
        }
        const level = headingLevelOf.get(lineNumber);
        if (level !== undefined) {
            return { text, kind: "heading", level };
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

/** Highlighted code, keyed by zero-based source line index. */
interface CodeHighlights {
    lines: Map<number, CodeRun[]>;
    /**
     * True when something here could have been highlighted but Prism was not
     * loaded. The caller loads it and renders again.
     */
    pending: boolean;
}

/**
 * Highlight the note's fenced code blocks and its frontmatter, both of which
 * the editor colours in Source mode and the panel has until now drawn flat.
 *
 * Every step degrades to no entry for the line, which renders as the plain
 * text it always did. A block whose tokenized line count disagrees with its
 * source line count is dropped whole rather than applied at a one-line offset:
 * the panel's whole job is to line up with the note.
 */
function collectCodeHighlights(this: void, lines: string[]): CodeHighlights {
    const highlights: CodeHighlights = { lines: new Map(), pending: false };
    const ready = isPrismReady();

    const apply = (first: number, last: number, language: string) => {
        if (last < first || !language) return;
        if (!ready) {
            highlights.pending = true;
            return;
        }
        const block = lines.slice(first, last + 1);
        const runs = highlightCode(block.join("\n"), language);
        if (!runs || runs.length !== block.length) return;
        runs.forEach((run, offset) => highlights.lines.set(first + offset, run));
    };

    for (const block of getFencedCodeBlocks(lines)) {
        // The fences themselves are punctuation the code does not contain.
        apply(
            block.open + 1,
            Math.min(block.close, lines.length) - 1,
            block.language
        );
    }

    // Frontmatter is YAML between two `---` delimiters, which are no more part
    // of the document than a fence is part of its code.
    const frontmatter = getFrontmatterLineCount(lines);
    if (frontmatter > 0) apply(1, frontmatter - 2, "yaml");

    return highlights;
}

function fillCodeLine(this: void, element: HTMLElement, runs: CodeRun[]) {
    if (runs.length === 0) {
        element.textContent = "​";
        return;
    }
    for (const run of runs) {
        appendToken(element, run.text, run.className ?? undefined);
    }
}

export interface SourceLineDom {
    fragment: DocumentFragment;
    /** One element per source line, index 0 being line 1. */
    elements: HTMLElement[];
    /** Source line numbers of the headings, for anchor pairing. */
    headingLines: number[];
    /** Heading levels, parallel to `headingLines`, for resolving fold extents. */
    headingLevels: number[];
    /**
     * True when code or frontmatter went out flat only because Prism had not
     * loaded yet, so the caller knows a second render is worth it.
     */
    prismPending: boolean;
}

export function buildSourceLineDom(
    this: void,
    markdown: string
): SourceLineDom {
    const lines = classifySourceLines(markdown);
    const highlights = collectCodeHighlights(markdown.split(/\r?\n/));
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
        // Code and frontmatter carry no Markdown to colour \u2014 but the editor
        // still highlights what is inside them, by language, so the panel does
        // the same wherever Prism can tokenize it.
        if (line.kind === "code" || line.kind === "frontmatter") {
            const runs = highlights.lines.get(index);
            if (runs) {
                fillCodeLine(element, runs);
            } else {
                element.textContent =
                    line.text.length > 0 ? line.text : "\u200B";
            }
        } else {
            fillLine(element, line.text);
        }
        elements.push(element);
        fragment.appendChild(element);
    });

    return {
        fragment,
        elements,
        headingLines,
        headingLevels,
        prismPending: highlights.pending,
    };
}

/** Apply actual CM fold ranges, without importing its provisional heights. */
export function applySourceFolds(elements: HTMLElement[], editor: EditorView | null) {
    for (const element of elements) element.hidden = false;
    if (!editor) return;
    const doc = editor.state.doc;
    foldedRanges(editor.state).between(0, doc.length, (from, to) => {
        const first = doc.lineAt(from).number;
        const last = doc.lineAt(to).number;
        for (let line = first + 1; line <= last; line++) {
            if (elements[line - 1]) elements[line - 1].hidden = true;
        }
    });
}

export function sourceFoldSignature(editor: EditorView | null): string {
    if (!editor) return "";
    const ranges: string[] = [];
    foldedRanges(editor.state).between(0, editor.state.doc.length, (from, to) => {
        ranges.push(`${from}:${to}`);
    });
    return ranges.join(",");
}
