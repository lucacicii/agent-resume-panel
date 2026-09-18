import { useCallback, useEffect } from "react";
import { desktopApi } from "../bridge";
import { useOverlayState } from "../components/useOverlayMotion";
import { notifyDesktop } from "../components/Notifications";
import { ThemeIcon } from "../components/ThemeIcon";
import { renderMarkdown } from "../components/Markdown";
import { useI18n } from "../i18n";
import type { SelectionAction } from "../../shared/selectionActions";

type SelectionActionResultState = {
  x: number;
  y: number;
  title: string;
  text: string;
  loading: boolean;
};

export type SelectionActionRunInput = {
  action: SelectionAction;
  text: string;
  x: number;
  y: number;
};

type Translate = (key: string, ...args: Array<string | number>) => string;

export function selectionActionLabel(action: SelectionAction, t: Translate): string {
  if (action.actionId === "translate") return t("desktop.selection.translate");
  if (action.actionId === "explain") return t("desktop.selection.explain");
  return action.name;
}

export function copySelectionText(text: string, successText: string): void {
  try {
    desktopApi().clipboardWriteText(text);
    notifyDesktop({ text: successText, kind: "ok" });
  } catch (error) {
    notifyDesktop({ text: error instanceof Error ? error.message : String(error), kind: "error" });
  }
}

export function useSelectionActionResult(): {
  selectionResult: SelectionActionResultState | null;
  selectionResultClosing: boolean;
  runSelectionAction: (input: SelectionActionRunInput) => Promise<void>;
  copySelectionResult: (text: string) => void;
  clearSelectionResult: () => void;
} {
  const { t } = useI18n();
  const [selectionResult, setSelectionResult, selectionResultClosing] = useOverlayState<SelectionActionResultState>();

  const runSelectionAction = useCallback(async ({ action, text, x, y }: SelectionActionRunInput) => {
    const title = selectionActionLabel(action, t);
    setSelectionResult({ x, y, title, text: "", loading: true });
    try {
      const result = await desktopApi().selectionRunAction({ actionId: action.actionId, text });
      setSelectionResult((current) =>
        current?.loading && current.title === title
          ? { x, y, title, text: result.text, loading: false }
          : current
      );
    } catch (error) {
      setSelectionResult(null);
      notifyDesktop({ text: error instanceof Error ? error.message : String(error), kind: "error" });
    }
  }, [t]);

  const copySelectionResult = useCallback((text: string) => {
    copySelectionText(text, t("desktop.common.copied"));
  }, [t]);

  const clearSelectionResult = useCallback(() => setSelectionResult(null), []);

  return { selectionResult, selectionResultClosing, runSelectionAction, copySelectionResult, clearSelectionResult };
}

function resultPosition(x: number, y: number): { left: number; top: number } {
  const width = Math.min(360, window.innerWidth - 16);
  return {
    left: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
    top: Math.max(8, Math.min(y, window.innerHeight - 328))
  };
}

export function SelectionActionResult({
  result,
  closing = false,
  onClose,
  onCopy
}: {
  result: SelectionActionResultState;
  closing?: boolean;
  onClose: () => void;
  onCopy: (text: string) => void;
}): React.JSX.Element {
  const { t } = useI18n();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className={`selection-action-result${closing ? " is-closing" : ""}`}
      role="dialog"
      aria-label={result.title}
      style={resultPosition(result.x, result.y)}
      onContextMenu={(event) => event.preventDefault()}
    >
      <header>
        <strong>{result.title}</strong>
        <span className="selection-action-result-actions">
          {!result.loading ? (
            <button type="button" className="tool-btn ghost-btn" onClick={() => onCopy(result.text)}>
              {t("desktop.common.copy")}
            </button>
          ) : null}
          <button
            type="button"
            className="tool-btn ghost-btn"
            aria-label={t("desktop.common.close")}
            title={t("desktop.common.close")}
            onClick={onClose}
          >
            <ThemeIcon name="close" size={12} />
          </button>
        </span>
      </header>
      {result.loading ? (
        <p className="selection-action-running" role="status">{t("desktop.selection.actionRunning")}</p>
      ) : (
        <div className="markdown-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(result.text) }} />
      )}
    </div>
  );
}
