import type { BrowserDevtoolsLogEntry, BrowserProbeMarkup, BrowserProbeTarget } from "../../../shared/browserTypes";

type Translate = (key: string, ...args: Array<string | number>) => string;

/**
 * Prompts assembled from browser-panel picks. They are contract text: agents
 * rely on the headings to know the user selected one element or one region
 * rather than asking for a page-wide change.
 */

export function buildInspectPrompt(t: Translate, target: BrowserProbeTarget): string {
  const component =
    target.componentName && target.componentName.toLowerCase() !== target.tagName.toLowerCase()
      ? target.componentName
      : "";
  const lines = [
    t("desktop.browser.probe.inspectHeading"),
    component
      ? t("desktop.browser.probe.elementInComponent", target.tagName, component)
      : t("desktop.browser.probe.element", target.tagName)
  ];
  if (target.selector) lines.push(t("desktop.browser.probe.selector", target.selector));
  if (target.text) lines.push(t("desktop.browser.probe.text", target.text));
  if (target.sourceFile) {
    lines.push(
      target.sourceLocated === false
        ? t("desktop.browser.probe.sourceApprox", target.sourceFile)
        : t("desktop.browser.probe.source", target.sourceFile, target.sourceLine ?? "")
    );
  }
  if (target.outerHTMLSnippet) lines.push(t("desktop.browser.probe.html", target.outerHTMLSnippet));
  return lines.join("\n");
}

/** `[target element, source location]`, in the order both markup dialects print them. */
function markupTargetLines(t: Translate, target: BrowserProbeMarkup["target"]): string[] {
  if (!target) return [];
  const lines = [t("desktop.browser.probe.markupTarget", target.tagName)];
  if (target.sourceFile) {
    lines.push(t("desktop.browser.probe.markupSource", target.sourceFile, target.sourceLine ?? ""));
  }
  return lines;
}

export function buildMarkupPrompt(t: Translate, markups: BrowserProbeMarkup[]): string {
  if (markups.length === 1) {
    const [markup] = markups;
    return [
      t("desktop.browser.probe.markupSingle", markup.note),
      markup.target
        ? t("desktop.browser.probe.markupScopeOne")
        : t("desktop.browser.probe.markupScopeUnlocated"),
      ...markupTargetLines(t, markup.target)
    ].join("\n");
  }

  const lines = [t("desktop.browser.probe.markupMany", markups.length)];
  markups.forEach((markup, index) => {
    lines.push(
      t("desktop.browser.probe.markupIndex", index + 1),
      t("desktop.browser.probe.markupNote", markup.note),
      ...markupTargetLines(t, markup.target)
    );
  });
  return lines.join("\n");
}

export function composeErrorPrompt(t: Translate, entry: BrowserDevtoolsLogEntry): string {
  const lines = [
    t("desktop.browser.console.fixHeading"),
    t("desktop.browser.console.fixText", entry.text)
  ];
  if (entry.stack) lines.push(t("desktop.browser.console.fixStack", entry.stack));
  lines.push(t("desktop.browser.console.fixOutro"));
  return lines.join("\n");
}
