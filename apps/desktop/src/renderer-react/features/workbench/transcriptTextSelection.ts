type CaretDocument = Document & {
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
};

export function rangeFromPoint(x: number, y: number): Range | null {
  const doc = document as CaretDocument;
  if (typeof doc.caretRangeFromPoint === "function") {
    const range = doc.caretRangeFromPoint(x, y);
    if (!range) return null;
    const next = range.cloneRange();
    if (!next.collapsed) next.collapse(true);
    return next;
  }
  const position = doc.caretPositionFromPoint?.(x, y);
  if (!position?.offsetNode) return null;
  const range = document.createRange();
  range.setStart(position.offsetNode, position.offset);
  range.collapse(true);
  return range;
}

export function rangeFromBoundary(anchor: Range, point: Range): Range {
  const startFirst = anchor.compareBoundaryPoints(Range.START_TO_START, point) <= 0;
  const range = document.createRange();
  if (startFirst) {
    range.setStart(anchor.startContainer, anchor.startOffset);
    range.setEnd(point.startContainer, point.startOffset);
  } else {
    range.setStart(point.startContainer, point.startOffset);
    range.setEnd(anchor.startContainer, anchor.startOffset);
  }
  return range;
}

export function applyTranscriptPointerSelection(
  root: HTMLElement,
  x: number,
  y: number,
  anchor: Range | null
): Range | null {
  const point = rangeFromPoint(x, y);
  if (!point || !root.contains(point.startContainer)) return null;
  const next = anchor ? rangeFromBoundary(anchor, point) : point.cloneRange();
  const selection = window.getSelection();
  if (!selection) return null;
  selection.removeAllRanges();
  selection.addRange(next);
  return point;
}
