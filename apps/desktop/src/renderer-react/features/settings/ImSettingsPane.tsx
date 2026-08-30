import { useCallback, useEffect, useState } from "react";
import type { PanelSettings } from "@agent-resume/core";
import { desktopApi } from "../../bridge";
import { listProviderModels } from "./providerPool";
import {
  isBuiltinSelectionActionId,
  isBuiltinTemplateId,
  type ImAgent,
  type ImRoleTemplate,
  type ImRoleTools,
  type ImSelectionAction,
  type ImSelectionActionKind
} from "../../../shared/imTypes";

type Translate = (key: string, ...args: Array<string | number>) => string;
const AGENTS: ImAgent[] = ["pi", "claude", "codex"];

function emptyDraft(): { name: string; persona: string; agent: ImAgent; tools: ImRoleTools } {
  return {
    name: "",
    persona: "",
    agent: "claude",
    tools: { fsRead: true, fsWrite: false, execute: false }
  };
}

export function ImSettingsPane({ t }: { t: Translate }): React.JSX.Element {
  const [templates, setTemplates] = useState<ImRoleTemplate[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [persona, setPersona] = useState("");
  const [agent, setAgent] = useState<ImAgent>("claude");
  const [tools, setTools] = useState<ImRoleTools>(emptyDraft().tools);
  const [status, setStatus] = useState("");
  const [settings, setSettings] = useState<PanelSettings | null>(null);
  const [actions, setActions] = useState<ImSelectionAction[]>([]);
  const [selectedActionId, setSelectedActionId] = useState("");
  const [creatingAction, setCreatingAction] = useState(false);
  const [actionName, setActionName] = useState("");
  const [actionKind, setActionKind] = useState<ImSelectionActionKind>("independent");
  const [actionPrompt, setActionPrompt] = useState("");
  const [actionProviderId, setActionProviderId] = useState<string>("");
  const [actionModelId, setActionModelId] = useState<string>("");
  const [actionEnabled, setActionEnabled] = useState(true);
  const selectedAction = actions.find((item) => item.actionId === selectedActionId) ?? null;

  const selected = templates.find((item) => item.templateId === selectedId) ?? null;

  const load = useCallback(async () => {
    const [list, nextActions, currentSettings] = await Promise.all([
      desktopApi().imListTemplates(),
      desktopApi().imListSelectionActions(),
      desktopApi().getSettings()
    ]);
    setTemplates(list);
    setSelectedId((current) => current && list.some((item) => item.templateId === current) ? current : list[0]?.templateId || "");
    setActions(nextActions);
    setSelectedActionId((current) => current && nextActions.some((item) => item.actionId === current) ? current : nextActions[0]?.actionId || "");
    setSettings(currentSettings);
  }, []);

  useEffect(() => {
    void load().catch((error: unknown) => setStatus(error instanceof Error ? error.message : String(error)));
  }, [load]);

  useEffect(() => {
    if (creating) {
      const draft = emptyDraft();
      setName(draft.name);
      setPersona(draft.persona);
      setAgent(draft.agent);
      setTools(draft.tools);
      return;
    }
    if (!selected) return;
    setName(selected.name);
    setPersona(selected.persona);
    setAgent(selected.agent);
    setTools(selected.tools);
  }, [creating, selected]);

  useEffect(() => {
    if (creatingAction) {
      setActionName("");
      setActionKind("independent");
      setActionPrompt("Explain the following text.\n\n{selection}");
      setActionProviderId("");
      setActionModelId("");
      setActionEnabled(true);
      return;
    }
    if (!selectedAction) return;
    setActionName(selectedAction.name);
    setActionKind(selectedAction.kind);
    setActionPrompt(selectedAction.prompt);
    setActionProviderId(selectedAction.providerId ?? "");
    setActionModelId(selectedAction.modelId ?? "");
    setActionEnabled(selectedAction.enabled);
  }, [creatingAction, selectedAction]);

  const save = useCallback(async () => {
    try {
      if (creating) {
        const created = await desktopApi().imCreateTemplate({ name, persona, agent, tools });
        setCreating(false);
        await load();
        setSelectedId(created.templateId);
      } else if (selected) {
        await desktopApi().imUpdateTemplate({
          templateId: selected.templateId,
          name,
          persona,
          agent,
          tools
        });
        await load();
      }
      setStatus(t("desktop.settings.imSaved"));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }, [agent, creating, load, name, persona, selected, t, tools]);

  const remove = useCallback(async () => {
    if (!selected || isBuiltinTemplateId(selected.templateId)) return;
    try {
      await desktopApi().imDeleteTemplate({ templateId: selected.templateId });
      setSelectedId("");
      await load();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }, [load, selected]);

  const saveAction = useCallback(async () => {
    try {
      if (creatingAction) {
        const created = await desktopApi().imCreateSelectionAction({
          name: actionName,
          kind: actionKind,
          prompt: actionPrompt,
          providerId: actionProviderId || undefined,
          modelId: actionModelId || undefined
        });
        setCreatingAction(false);
        await load();
        setSelectedActionId(created.actionId);
      } else if (selectedAction) {
        await desktopApi().imUpdateSelectionAction({
          actionId: selectedAction.actionId,
          name: actionName,
          kind: isBuiltinSelectionActionId(selectedAction.actionId) ? undefined : actionKind,
          prompt: actionPrompt,
          providerId: actionProviderId || undefined,
          modelId: actionModelId || undefined,
          enabled: actionEnabled
        });
        await load();
      }
      setStatus(t("desktop.settings.imActionSaved"));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }, [actionEnabled, actionKind, actionModelId, actionName, actionPrompt, actionProviderId, creatingAction, load, selectedAction, t]);

  const removeAction = useCallback(async () => {
    if (!selectedAction || isBuiltinSelectionActionId(selectedAction.actionId)) return;
    try {
      await desktopApi().imDeleteSelectionAction({ actionId: selectedAction.actionId });
      setSelectedActionId("");
      await load();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }, [load, selectedAction]);

  return (
    <>
    <section className="settings-group">
      <h3 className="settings-group-title">{t("desktop.settings.imTemplates")}</h3>
      <div className="settings-group-body im-settings-layout">
        <p className="settings-footnote">{t("desktop.settings.imTemplatesHint")}</p>
        <div className="im-settings-split">
          <div className="im-settings-list">
            {templates.map((template) => (
              <button
                key={template.templateId}
                type="button"
                className={`im-settings-item${selectedId === template.templateId && !creating ? " active" : ""}`}
                onClick={() => {
                  setCreating(false);
                  setSelectedId(template.templateId);
                }}
              >
                {template.name}
                {isBuiltinTemplateId(template.templateId) ? <span>{t("desktop.settings.imBuiltin")}</span> : null}
              </button>
            ))}
            <button type="button" className="im-settings-item" onClick={() => setCreating(true)}>
              {t("desktop.settings.imNewTemplate")}
            </button>
          </div>
          <div className="im-settings-editor">
            <label className="settings-field">
              <span className="settings-field-label">{t("desktop.settings.imName")}</span>
              <input value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <label className="settings-field">
              <span className="settings-field-label">{t("desktop.settings.imAgent")}</span>
              <select value={agent} onChange={(event) => setAgent(event.target.value as ImAgent)}>
                {AGENTS.map((item) => (
                  <option key={item} value={item}>{t(`desktop.im.agent.${item}`)}</option>
                ))}
              </select>
            </label>
            <label className="settings-field">
              <span className="settings-field-label">{t("desktop.settings.imPrompt")}</span>
              <textarea rows={8} value={persona} onChange={(event) => setPersona(event.target.value)} />
            </label>
            <fieldset className="im-settings-tools">
              <legend>{t("desktop.settings.imTools")}</legend>
              <p className="settings-footnote">{t("desktop.settings.imToolReadAlways")}</p>
              <label>
                <input type="checkbox" checked={tools.fsWrite} onChange={(event) => setTools({ ...tools, fsRead: true, fsWrite: event.target.checked })} />
                {t("desktop.settings.imToolWrite")}
              </label>
              <label>
                <input type="checkbox" checked={tools.execute} onChange={(event) => setTools({ ...tools, fsRead: true, execute: event.target.checked })} />
                {t("desktop.settings.imToolExecute")}
              </label>
            </fieldset>
            <div className="im-add-role-actions">
              <button type="button" className="btn primary" onClick={() => void save()}>{t("desktop.settings.save")}</button>
              {selected && !isBuiltinTemplateId(selected.templateId) && !creating ? (
                <button type="button" className="ghost-btn" onClick={() => void remove()}>{t("desktop.settings.imDeleteTemplate")}</button>
              ) : null}
            </div>
            {status ? <p className="settings-footnote">{status}</p> : null}
          </div>
        </div>
      </div>
    </section>
    <section className="settings-group">
      <h3 className="settings-group-title">{t("desktop.settings.imActions")}</h3>
      <div className="settings-group-body im-settings-layout">
        <p className="settings-footnote">{t("desktop.settings.imActionsHint")}</p>
        <div className="im-settings-split">
          <div className="im-settings-list">
            {actions.map((action) => (
              <button
                key={action.actionId}
                type="button"
                className={`im-settings-item${selectedActionId === action.actionId && !creatingAction ? " active" : ""}`}
                onClick={() => {
                  setCreatingAction(false);
                  setSelectedActionId(action.actionId);
                }}
              >
                {action.name}
                {isBuiltinSelectionActionId(action.actionId) ? <span>{t("desktop.settings.imBuiltin")}</span> : null}
              </button>
            ))}
            <button type="button" className="im-settings-item" onClick={() => setCreatingAction(true)}>
              {t("desktop.settings.imNewAction")}
            </button>
          </div>
          <div className="im-settings-editor">
            <label className="settings-field">
              <span className="settings-field-label">{t("desktop.settings.imName")}</span>
              <input value={actionName} onChange={(event) => setActionName(event.target.value)} />
            </label>
            <label className="settings-field">
              <span className="settings-field-label">{t("desktop.settings.imActionKind")}</span>
              <select
                value={actionKind}
                disabled={Boolean(selectedAction && isBuiltinSelectionActionId(selectedAction.actionId) && !creatingAction)}
                onChange={(event) => setActionKind(event.target.value as ImSelectionActionKind)}
              >
                <option value="context">{t("desktop.settings.imActionKindContext")}</option>
                <option value="independent">{t("desktop.settings.imActionKindIndependent")}</option>
              </select>
            </label>
            {actionKind === "independent" ? (
              <label className="settings-field">
                <span className="settings-field-label">{t("desktop.settings.imActionModel")}</span>
                <select
                  className="settings-row-control"
                  data-testid="settings-im-action-model-select"
                  value={actionProviderId && actionModelId ? `${actionProviderId}:${actionModelId}` : ""}
                  onChange={(event) => {
                    const val = event.target.value;
                    if (!val) {
                      setActionProviderId("");
                      setActionModelId("");
                    } else {
                      const [pId, mId] = val.split(":");
                      setActionProviderId(pId || "");
                      setActionModelId(mId || "");
                    }
                  }}
                >
                  <option value="">{t("desktop.settings.imActionModelDefault")}</option>
                  {listProviderModels(settings?.providers ?? [], "text").map((item) => (
                    <option key={`${item.providerId}:${item.modelId}`} value={`${item.providerId}:${item.modelId}`}>
                      {item.providerName} / {item.modelId}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="settings-field">
              <span className="settings-field-label">{t("desktop.settings.imActionPrompt")}</span>
              <textarea rows={6} value={actionPrompt} onChange={(event) => setActionPrompt(event.target.value)} />
            </label>
            <p className="settings-footnote">{t("desktop.settings.imActionPromptHint")}</p>
            <label>
              <input type="checkbox" checked={actionEnabled} onChange={(event) => setActionEnabled(event.target.checked)} />
              {t("desktop.settings.imActionEnabled")}
            </label>
            <div className="im-add-role-actions">
              <button type="button" className="btn primary" onClick={() => void saveAction()}>{t("desktop.settings.save")}</button>
              {selectedAction && !isBuiltinSelectionActionId(selectedAction.actionId) && !creatingAction ? (
                <button type="button" className="ghost-btn" onClick={() => void removeAction()}>{t("desktop.settings.imDeleteAction")}</button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </section>
    </>
  );
}
