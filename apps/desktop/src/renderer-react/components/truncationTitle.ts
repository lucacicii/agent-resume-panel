/**
 * Keep the native `title` tooltip in sync with a possibly truncated list cell: set it while
 * the text overflows (single-line ellipsis or line-clamp), remove it otherwise. Intended for
 * use as an inline ref callback (`ref={(el) => syncTruncationTitle(el)}`) so re-renders that
 * update the cell text re-measure the element.
 */
export function syncTruncationTitle(el: HTMLElement | null): void {
  if (!el) return;
  const truncated = el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
  const text = el.textContent || "";
  if (truncated && text) {
    el.setAttribute("title", text);
  } else {
    el.removeAttribute("title");
  }
}
