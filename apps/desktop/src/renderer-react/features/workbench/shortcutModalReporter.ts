/**
 * Reports to main whether any modal dialog (`[aria-modal="true"]`) is open in the
 * main-window renderer. Main uses this to suppress the workbench ⌘+Arrow pane
 * navigation while a modal (e.g. the ⌘P Quick Access palette) is on screen.
 *
 * The observer runs for the lifetime of the workbench renderer. The floating note
 * (`FloatingSessionNote`) is `role="dialog"` but intentionally has no
 * `aria-modal`, so it is not counted here — its focus is reported separately via
 * `setFloatingNoteFocused`.
 */

let observer: MutationObserver | null = null;
let lastOpen: boolean | null = null;

export function startModalOpenReporter(): () => void {
  if (observer) return () => undefined;
  const report = () => {
    const open = Boolean(document.querySelector('[aria-modal="true"]'));
    if (open === lastOpen) return;
    lastOpen = open;
    if (typeof window.agentResume.setModalOpen === "function") {
      window.agentResume.setModalOpen(open);
    }
  };
  observer = new MutationObserver(report);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["aria-modal"]
  });
  report();
  return () => {
    observer?.disconnect();
    observer = null;
    lastOpen = null;
  };
}
