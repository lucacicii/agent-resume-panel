import { useEffect, useState } from "react";
import { desktopApi } from "../bridge";
import { notifyDesktop } from "../components/Notifications";
import { useI18n } from "../i18n";
import type { ImSelectionAction } from "../../shared/imTypes";
import { SelectionSendItems } from "./SelectionSendMenu";
import {
  copySelectionText,
  selectionActionLabel,
  type SelectionActionRunInput
} from "./SelectionActionResult";

export function SelectionActionItems({
  text,
  projectPath,
  onSent,
  className = "notes-selection-menu",
  actions,
  onActionStart,
  runAction,
  x,
  y
}: {
  text: string;
  projectPath?: string;
  onSent: () => void;
  className?: string;
  actions?: ImSelectionAction[];
  onActionStart?: () => void;
  runAction: (input: SelectionActionRunInput) => Promise<void>;
  x: number;
  y: number;
}): React.JSX.Element {
  const { t } = useI18n();
  const [loadedActions, setLoadedActions] = useState<ImSelectionAction[]>([]);

  useEffect(() => {
    if (actions) return;
    const api = desktopApi();
    if (typeof api.imListSelectionActions !== "function") return;
    let cancelled = false;
    void api.imListSelectionActions()
      .then((next) => {
        if (!cancelled) setLoadedActions(next);
      })
      .catch((error: unknown) => {
        notifyDesktop({ text: error instanceof Error ? error.message : String(error), kind: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [actions]);

  const independentActions = (actions ?? loadedActions).filter((action) =>
    action.enabled && action.kind === "independent"
  );

  return (
    <>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          copySelectionText(text, t("desktop.common.copied"));
          onSent();
        }}
      >
        {t("desktop.common.copy")}
      </button>
      {independentActions.map((action) => (
        <button
          key={action.actionId}
          type="button"
          role="menuitem"
          onClick={() => {
            onActionStart?.();
            void runAction({ action, text, x, y });
          }}
        >
          {selectionActionLabel(action, t)}
        </button>
      ))}
      <div className="context-menu-separator" role="separator" />
      <SelectionSendItems text={text} projectPath={projectPath} onSent={onSent} className={className} />
    </>
  );
}
