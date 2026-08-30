import { useCallback, useEffect, useState } from "react";
import { desktopApi } from "../../bridge";
import { isBuiltinTemplateId, type ImAgent, type ImRoleTemplate, type ImRoleTools } from "../../../shared/imTypes";

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

  const selected = templates.find((item) => item.templateId === selectedId) ?? null;

  const load = useCallback(async () => {
    const list = await desktopApi().imListTemplates();
    setTemplates(list);
    setSelectedId((current) => current && list.some((item) => item.templateId === current) ? current : list[0]?.templateId || "");
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

  return (
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
  );
}
