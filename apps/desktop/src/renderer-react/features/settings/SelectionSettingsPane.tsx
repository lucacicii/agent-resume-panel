import { useCallback, useEffect, useState } from "react";
import type { PanelSettings } from "@agent-resume/core";
import { desktopApi } from "../../bridge";
import { confirmDestructive } from "../../confirmAction";
import { ICON_SIZE, ThemeIcon } from "../../components/ThemeIcon";
import {
  isBuiltinSelectionActionId,
  type SelectionAction
} from "../../../shared/selectionActions";
import { listProviderModels } from "./providerPool";

type Translate = (key: string, ...args: Array<string | number>) => string;

export function SelectionSettingsPane({ t }: { t: Translate }): React.JSX.Element {
  const [settings, setSettings] = useState<PanelSettings | null>(null);
  const [actions, setActions] = useState<SelectionAction[]>([]);
  const [selectedActionId, setSelectedActionId] = useState("");
  const [creatingAction, setCreatingAction] = useState(false);
  const [actionName, setActionName] = useState("");
  const [actionPrompt, setActionPrompt] = useState("");
  const [actionProviderId, setActionProviderId] = useState<string>("");
  const [actionModelId, setActionModelId] = useState<string>("");
  const [actionEnabled, setActionEnabled] = useState(true);
  const [status, setStatus] = useState("");

  const selectedAction = actions.find((item) => item.actionId === selectedActionId) ?? null;

  const load = useCallback(async () => {
    const [nextActions, currentSettings] = await Promise.all([
      desktopApi().selectionListActions(),
      desktopApi().getSettings()
    ]);
    setActions(nextActions);
    setSelectedActionId((current) => current && nextActions.some((item) => item.actionId === current) ? current : nextActions[0]?.actionId || "");
    setSettings(currentSettings);
  }, []);

  useEffect(() => {
    void load().catch((error: unknown) => setStatus(error instanceof Error ? error.message : String(error)));
  }, [load]);

  useEffect(() => {
    if (creatingAction) {
      setActionName("");
      setActionPrompt("Explain the following text.\n\n{selection}");
      setActionProviderId("");
      setActionModelId("");
      setActionEnabled(true);
      return;
    }
    if (!selectedAction) return;
    setActionName(selectedAction.name);
    setActionPrompt(selectedAction.prompt);
    setActionProviderId(selectedAction.providerId ?? "");
    setActionModelId(selectedAction.modelId ?? "");
    setActionEnabled(selectedAction.enabled);
  }, [creatingAction, selectedAction]);

  const createAction = useCallback(async () => {
    if (!creatingAction) return;
    try {
      const created = await desktopApi().selectionCreateAction({
        name: actionName,
        prompt: actionPrompt,
        providerId: actionProviderId || undefined,
        modelId: actionModelId || undefined
      });
      setCreatingAction(false);
      await load();
      setSelectedActionId(created.actionId);
      setStatus(t("desktop.settings.selectionActionSaved"));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }, [actionModelId, actionName, actionPrompt, actionProviderId, creatingAction, load, t]);

  /** Editing an existing action auto-saves: inputs on blur, selects and toggles on change. */
  const persistAction = useCallback(async (overrides?: Partial<{ name: string; prompt: string; providerId: string; modelId: string; enabled: boolean }>) => {
    if (creatingAction || !selectedAction) return;
    const payload = {
      name: overrides?.name ?? actionName,
      prompt: overrides?.prompt ?? actionPrompt,
      providerId: (overrides?.providerId ?? actionProviderId) || undefined,
      modelId: (overrides?.modelId ?? actionModelId) || undefined,
      enabled: overrides?.enabled ?? actionEnabled
    };
    if (
      payload.name === selectedAction.name &&
      payload.prompt === selectedAction.prompt &&
      (payload.providerId ?? "") === (selectedAction.providerId ?? "") &&
      (payload.modelId ?? "") === (selectedAction.modelId ?? "") &&
      payload.enabled === selectedAction.enabled
    ) return;
    try {
      await desktopApi().selectionUpdateAction({ actionId: selectedAction.actionId, ...payload });
      await load();
      setStatus(t("desktop.settings.selectionActionSaved"));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }, [actionEnabled, actionModelId, actionName, actionPrompt, actionProviderId, creatingAction, load, selectedAction, t]);

  const removeAction = useCallback(async () => {
    if (!selectedAction || isBuiltinSelectionActionId(selectedAction.actionId)) return;
    if (!(await confirmDestructive(t("desktop.settings.selectionDeleteActionConfirm"), t("desktop.common.delete")))) return;
    try {
      await desktopApi().selectionDeleteAction({ actionId: selectedAction.actionId });
      setSelectedActionId("");
      await load();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }, [load, selectedAction, t]);

  const moveAction = useCallback(async (index: number, offset: -1 | 1) => {
    const nextIndex = index + offset;
    if (nextIndex < 0 || nextIndex >= actions.length) return;
    const nextActions = [...actions];
    const [moved] = nextActions.splice(index, 1);
    nextActions.splice(nextIndex, 0, moved);
    const previousActions = actions;
    setActions(nextActions);
    try {
      const saved = await desktopApi().selectionReorderActions({
        actionIds: nextActions.map((action) => action.actionId)
      });
      setActions(saved);
      setStatus(t("desktop.settings.selectionActionOrderSaved"));
    } catch (error) {
      setActions(previousActions);
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }, [actions, t]);

  return (
    <section className="settings-group">
      <h3 className="settings-group-title">{t("desktop.settings.selectionActions")}</h3>
      <div className="settings-group-body">
        <p className="settings-footnote">{t("desktop.settings.selectionActionsHint")}</p>
        <div className="selection-settings-split">
          <div className="selection-settings-list">
            {actions.map((action, index) => (
              <div className="selection-settings-action-row" key={action.actionId}>
                <button
                  type="button"
                  className={`selection-settings-item${selectedActionId === action.actionId && !creatingAction ? " active" : ""}`}
                  onClick={() => {
                    setCreatingAction(false);
                    setSelectedActionId(action.actionId);
                  }}
                >
                  {action.name}
                  {isBuiltinSelectionActionId(action.actionId) ? <span>{t("desktop.settings.selectionBuiltin")}</span> : null}
                </button>
                <span className="selection-settings-order-controls">
                  <button
                    type="button"
                    className="selection-settings-order-btn"
                    disabled={index === 0}
                    aria-label={t("desktop.settings.selectionActionMoveUp", action.name)}
                    title={t("desktop.settings.selectionActionMoveUp", action.name)}
                    onClick={() => void moveAction(index, -1)}
                  >
                    <ThemeIcon name="arrow-up" size={ICON_SIZE.inline} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="selection-settings-order-btn"
                    disabled={index === actions.length - 1}
                    aria-label={t("desktop.settings.selectionActionMoveDown", action.name)}
                    title={t("desktop.settings.selectionActionMoveDown", action.name)}
                    onClick={() => void moveAction(index, 1)}
                  >
                    <ThemeIcon name="arrow-down" size={ICON_SIZE.inline} aria-hidden="true" />
                  </button>
                </span>
              </div>
            ))}
            <button type="button" className="selection-settings-item" onClick={() => setCreatingAction(true)}>
              {t("desktop.settings.selectionNewAction")}
            </button>
          </div>
          <div className="selection-settings-editor">
            <label className="settings-field">
              <span className="settings-field-label">{t("desktop.settings.selectionName")}</span>
              <input
                value={actionName}
                onChange={(event) => setActionName(event.target.value)}
                onBlur={(event) => void persistAction({ name: event.currentTarget.value })}
              />
            </label>
            <label className="settings-field">
              <span className="settings-field-label">{t("desktop.settings.selectionActionModel")}</span>
              <select
                className="settings-row-control"
                data-testid="settings-selection-action-model-select"
                value={actionProviderId && actionModelId ? `${actionProviderId}:${actionModelId}` : ""}
                onChange={(event) => {
                  const val = event.target.value;
                  const [pId, mId] = val ? val.split(":") : ["", ""];
                  setActionProviderId(pId || "");
                  setActionModelId(mId || "");
                  void persistAction({ providerId: pId || "", modelId: mId || "" });
                }}
              >
                <option value="">{t("desktop.settings.selectionActionModelDefault")}</option>
                {listProviderModels(settings?.providers ?? [], "text").map((item) => (
                  <option key={`${item.providerId}:${item.modelId}`} value={`${item.providerId}:${item.modelId}`}>
                    {item.providerName} / {item.modelId}
                  </option>
                ))}
              </select>
            </label>
            <label className="settings-field">
              <span className="settings-field-label">{t("desktop.settings.selectionActionPrompt")}</span>
              <textarea
                rows={6}
                value={actionPrompt}
                onChange={(event) => setActionPrompt(event.target.value)}
                onBlur={(event) => void persistAction({ prompt: event.currentTarget.value })}
              />
            </label>
            <p className="settings-footnote">{t("desktop.settings.selectionActionPromptHint")}</p>
            <label className="selection-settings-checkbox-item">
              <input type="checkbox" checked={actionEnabled} onChange={(event) => { setActionEnabled(event.target.checked); void persistAction({ enabled: event.target.checked }); }} />
              <span>{t("desktop.settings.selectionActionEnabled")}</span>
            </label>
            <div className="selection-settings-actions">
              {creatingAction ? (
                <button type="button" className="btn primary" onClick={() => void createAction()}>{t("desktop.settings.selectionCreateAction")}</button>
              ) : null}
              {selectedAction && !isBuiltinSelectionActionId(selectedAction.actionId) && !creatingAction ? (
                <button type="button" className="ghost-btn" onClick={() => void removeAction()}>{t("desktop.settings.selectionDeleteAction")}</button>
              ) : null}
            </div>
            {status ? <p className="settings-footnote">{status}</p> : null}
          </div>
        </div>
      </div>
    </section>
  );
}
