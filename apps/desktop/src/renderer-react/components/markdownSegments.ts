import { parseMarkdownIntoBlocks } from "streamdown";
import { sanitizeMarkdownProseTags } from "./Markdown";
import {
  promoteBareImagePaths,
  rewriteMarkdownImageSyntax,
  type MarkdownImageOptions
} from "./markdownImage";

/**
 * Streaming markdown is append-only: every tick appends to the text already on
 * screen. Re-running the whole document through sanitizing and rendering on
 * each append re-parses content that already rendered — which is what makes a
 * streaming pane feel heavy.
 *
 * This module keeps a stable, block-aligned partition of the document and
 * groups consecutive blocks into segments of roughly
 * {@link MARKDOWN_SEGMENT_MIN_CHARS}. Only the last segment is still open;
 * earlier segments keep their identity (and prepared text) as long as the
 * document only grows, so a memoized render can drop them untouched. An append
 * therefore only sanitizes and re-renders the open segment.
 *
 * Segments are cut on `streamdown` block boundaries, so the rendered result is
 * identical to rendering the whole document in one pass.
 */
export const MARKDOWN_SEGMENT_MIN_CHARS = 2_000;

export type MarkdownSegment = {
  /** Raw markdown of the segment (may still grow while it is the open one). */
  raw: string;
  /** Sanitized markdown handed to the renderer. */
  prepared: string;
};

export type MarkdownSegmentState = {
  /** Raw content the state was derived from. */
  source: string;
  /** Identity of the image options the prepared segments were built with. */
  optionsKey: string;
  segments: MarkdownSegment[];
};

/**
 * Turns `[N1]` / `[S1]` / `[D1]` markers into citation links and
 * `noteId: <uuid>` into note links. Shared by whole-document and fragment
 * preparation so both run the same pipeline.
 */
export function preprocessMarkdownLinks(markdown: string): string {
  let result = markdown.replace(/\[(N|S|D)(\d+)\](?!\()/g, "[$1$2](#citation-$1$2)");
  result = result.replace(
    /(noteId[:：]\s*(?:`|<code>)?)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})((?:`|<\/code>)?)/gi,
    "$1[$2](#note-$2)$3"
  );
  return result;
}

/**
 * Sanitizes a markdown fragment. Fragment boundaries must sit between blocks
 * (never inside a fence or an inline code span), which the block-aligned
 * segments produced here guarantee.
 */
export function prepareMarkdownFragment(markdown: string, options?: MarkdownImageOptions): string {
  if (!markdown) return "";
  const linked = preprocessMarkdownLinks(markdown);
  const promoted = promoteBareImagePaths(linked, options);
  const rewritten = rewriteMarkdownImageSyntax(promoted, options);
  return sanitizeMarkdownProseTags(rewritten);
}

export function markdownOptionsKey(options?: MarkdownImageOptions): string {
  return options ? `${options.baseDir || ""}\u0000${options.rootDir || ""}` : "";
}

function takeSegment(
  reusable: readonly MarkdownSegment[],
  index: number,
  raw: string,
  options: MarkdownImageOptions | undefined
): MarkdownSegment {
  const cached = reusable[index];
  if (cached && cached.raw === raw) return cached;
  return { raw, prepared: prepareMarkdownFragment(raw, options) };
}

/**
 * Idempotent: calling it again with the content it already holds returns the
 * same state object, so a double-invoked render (StrictMode, memo replay) never
 * rebuilds the partition.
 */
export function buildMarkdownSegments(
  previous: MarkdownSegmentState | null,
  content: string,
  options?: MarkdownImageOptions,
  minChars: number = MARKDOWN_SEGMENT_MIN_CHARS
): MarkdownSegmentState {
  const optionsKey = markdownOptionsKey(options);
  if (previous && previous.source === content && previous.optionsKey === optionsKey) {
    return previous;
  }

  const reusable = previous && previous.optionsKey === optionsKey ? previous.segments : [];
  const segments = segmentMarkdown(content, reusable, options, minChars);
  return { source: content, optionsKey, segments };
}

function segmentMarkdown(
  content: string,
  reusable: readonly MarkdownSegment[],
  options: MarkdownImageOptions | undefined,
  minChars: number
): MarkdownSegment[] {
  if (!content) return [];
  const blocks = parseMarkdownIntoBlocks(content);
  // `streamdown` splits into concatenated slices; anything else is unexpected
  // and is rendered as a single segment.
  if (!blocks.length || blocks.join("") !== content) {
    return [{ raw: content, prepared: prepareMarkdownFragment(content, options) }];
  }

  const segments: MarkdownSegment[] = [];
  let current = "";
  for (const block of blocks) {
    if (current && current.length + block.length > minChars) {
      segments.push(takeSegment(reusable, segments.length, current, options));
      current = "";
    }
    current += block;
  }
  segments.push(takeSegment(reusable, segments.length, current, options));
  return segments;
}
