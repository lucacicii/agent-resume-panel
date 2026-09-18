import { useEffect, useState } from "react";
import { desktopApi } from "../bridge";
import { notifyDesktop } from "../components/Notifications";
import { useI18n } from "../i18n";
import type { SelectionAction } from "../../shared/selectionActions";
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
  onActionStart,
  runAction,
  x,
  y
}: {
  text: string;
  projectPath?: string;
  onSent: () => void;
  onActionStart?: () => void;
  runAction: (input: SelectionActionRunInput) => Promise<void>;
  x: number;
  y: number;
}): React.JSX.Element {
  const { t } = useI18n();
  const [actions, setActions] = useState<SelectionAction[]>([]);

  useEffect(() => {
    const api = desktopApi();
    if (typeof api.selectionListActions !== "function") return;
    let cancelled = false;
    void api.selectionListActions()
      .then((next) => {
        if (!cancelled) setActions(next);
      })
      .catch((error: unknown) => {
        notifyDesktop({ text: error instanceof Error ? error.message : String(error), kind: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const enabledActions = actions.filter((action) => action.enabled);

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
      {enabledActions.map((action) => (
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
      <SelectionSendItems text={text} projectPath={projectPath} onSent={onSent} />
    </>
  );
}
