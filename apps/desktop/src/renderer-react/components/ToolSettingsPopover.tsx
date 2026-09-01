import type { AgentToolCategory, AgentToolDescriptor } from "@agent-resume/core";
import { ThemeIcon } from "./ThemeIcon";
import type { ReactNode } from "react";

export type AskToolMode = "auto" | "custom" | "off";
export interface AskToolPrefs {
  mode: AskToolMode;
  enabledTools: string[];
}

export const TOOL_CATEGORY_ORDER: AgentToolCategory[] = [
  "notes",
  "reports",
  "sessions",
  "projects",
  "link_graph",
  "tags",
  "skills",
  "browser",
  "mcp"
];

export function ToolSettingsPopover({
  prefs,
  tools,
  onPrefsChange,
  onClose,
  t
}: {
  prefs: AskToolPrefs;
  tools: AgentToolDescriptor[];
  onPrefsChange: (next: AskToolPrefs) => void;
  onClose: () => void;
  t: (key: string, ...args: Array<string | number>) => string;
}): ReactNode {
  const selected = new Set(prefs.enabledTools);
  const toggleTool = (name: string) => {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    onPrefsChange({ ...prefs, enabledTools: [...next] });
  };
  const modeOptions: Array<{ value: AskToolMode; label: string }> = [
    { value: "auto", label: t("desktop.agent.toolsMode.auto") },
    { value: "custom", label: t("desktop.agent.toolsMode.custom") },
    { value: "off", label: t("desktop.agent.toolsMode.off") }
  ];
  const categoryLabel: Record<AgentToolCategory, string> = {
    notes: t("desktop.agent.toolCategory.notes"),
    reports: t("desktop.agent.toolCategory.reports"),
    sessions: t("desktop.agent.toolCategory.sessions"),
    projects: t("desktop.agent.toolCategory.projects"),
    link_graph: t("desktop.agent.toolCategory.link_graph"),
    tags: t("desktop.agent.toolCategory.tags"),
    skills: t("desktop.agent.toolCategory.skills", "Skills"),
    browser: t("desktop.agent.toolCategory.browser", "Browser"),
    mcp: t("desktop.agent.toolCategory.mcp", "MCP")
  };
  return (
    <div className="chat-tools-popover" role="dialog" aria-label={t("desktop.agent.toolsDialogTitle")}>
      <div className="chat-tools-popover-head">
        <span className="chat-tools-popover-title">{t("desktop.agent.toolsDialogTitle")}</span>
        <button type="button" className="icon-btn chat-tools-popover-close" aria-label={t("desktop.common.close")} onClick={onClose}>
          <ThemeIcon name="close" size={14} />
        </button>
      </div>
      <div className="chat-tools-modes" role="tablist" aria-label={t("desktop.agent.toolsModeTitle")}>
        {modeOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={prefs.mode === option.value}
            className={`chat-tools-mode${prefs.mode === option.value ? " active" : ""}`}
            onClick={() => onPrefsChange({ ...prefs, mode: option.value })}
          >
            {option.label}
          </button>
        ))}
      </div>
      {prefs.mode === "custom" ? (
        <>
          <div className="chat-tools-quick-actions">
            <button
              type="button"
              className="ghost-btn"
              disabled={tools.length === 0}
              onClick={() => onPrefsChange({ ...prefs, enabledTools: tools.map((tool) => tool.name) })}
            >
              {t("desktop.agent.toolsSelectAll")}
            </button>
            <button
              type="button"
              className="ghost-btn"
              disabled={tools.length === 0}
              onClick={() => onPrefsChange({ ...prefs, enabledTools: [] })}
            >
              {t("desktop.agent.toolsClearAll")}
            </button>
          </div>
          <div className="chat-tools-scroll">
            {tools.length === 0 ? (
              <div className="chat-tools-empty-hint">{t("desktop.common.loading")}</div>
            ) : (
              TOOL_CATEGORY_ORDER.map((category) => {
                const items = tools.filter((tool) => tool.category === category);
                if (!items.length) return null;
                return (
                  <div key={category} className="chat-tools-category">
                    <div className="chat-tools-category-label">{categoryLabel[category]}</div>
                    {items.map((tool) => (
                      <label key={tool.id || tool.name} className="chat-tools-item" title={tool.description}>
                        <input
                          type="checkbox"
                          checked={selected.has(tool.name)}
                          onChange={() => toggleTool(tool.name)}
                        />
                        <span className="chat-tools-item-name">{tool.name}</span>
                        <span className="chat-tools-item-desc">{tool.description}</span>
                      </label>
                    ))}
                  </div>
                );
              })
            )}
          </div>
          {tools.length > 0 && prefs.enabledTools.length === 0 ? (
            <div className="chat-tools-empty-hint">{t("desktop.agent.toolsCustomEmpty")}</div>
          ) : null}
        </>
      ) : null}
      {prefs.mode === "auto" ? <div className="chat-tools-foot">{t("desktop.agent.toolsFoot")}</div> : null}
    </div>
  );
}
