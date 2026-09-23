import { useCallback, useEffect, useMemo, useState } from "react";
import { Sheet } from "../../components/Sheet";
import { ThemeIcon } from "../../components/ThemeIcon";
import { SegmentedControl } from "../../components/SegmentedControl";
import { desktopApi } from "../../bridge";
import { useI18n } from "../../i18n";
import type {
  ThunderSchedule,
  ThunderScheduleInput,
  ScheduleTriggerType,
  ThunderModelInfo
} from "@agent-resume/core";

interface ScheduleEditorSheetProps {
  open: boolean;
  schedule: ThunderSchedule | null;
  onClose: () => void;
  onSave: (input: ThunderScheduleInput) => Promise<void>;
}

const INTERVAL_OPTIONS = [
  { value: "15m", label: "Every 15 minutes" },
  { value: "30m", label: "Every 30 minutes" },
  { value: "1h", label: "Every 1 hour" },
  { value: "2h", label: "Every 2 hours" },
  { value: "6h", label: "Every 6 hours" },
  { value: "12h", label: "Every 12 hours" },
  { value: "24h", label: "Every 24 hours" }
];

const TRIGGER_TYPE_OPTIONS: ScheduleTriggerType[] = ["interval", "daily", "cron", "manual"];

export function ScheduleEditorSheet({
  open,
  schedule,
  onClose,
  onSave
}: ScheduleEditorSheetProps) {
  const { ready, t } = useI18n();
  const text = (key: string, fallback: string) => (ready ? t(key) : fallback);

  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [workspaceDir, setWorkspaceDir] = useState("");
  const [triggerType, setTriggerType] = useState<ScheduleTriggerType>("interval");
  const [triggerValue, setTriggerValue] = useState("1h");
  const [model, setModel] = useState("");
  const [enabled, setEnabled] = useState(true);

  const [availableModels, setAvailableModels] = useState<ThunderModelInfo[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const groupedModels = useMemo(() => {
    const panelModels: ThunderModelInfo[] = [];
    const otherModels: ThunderModelInfo[] = [];

    for (const m of availableModels) {
      if (m.provider.startsWith("panel-") || m.provider === "panel-default" || m.provider === "panel-chat") {
        panelModels.push(m);
      } else {
        otherModels.push(m);
      }
    }

    return { panelModels, otherModels };
  }, [availableModels]);

  // Load models on open
  useEffect(() => {
    if (!open) return;
    void desktopApi()
      .thunderListModels()
      .then((models) => {
        setAvailableModels(models);
        if (!model && models.length > 0) {
          setModel(models[0].selection_id || models[0].id);
        }
      })
      .catch(() => undefined);
  }, [open, model]);

  // Sync form state from schedule or defaults
  useEffect(() => {
    if (schedule) {
      setName(schedule.name);
      setPrompt(schedule.prompt);
      setWorkspaceDir(schedule.workspaceDir || "");
      setTriggerType(schedule.triggerType);
      setTriggerValue(schedule.triggerValue);
      setModel(schedule.model || "");
      setEnabled(schedule.enabled);
    } else {
      setName("");
      setPrompt("");
      setWorkspaceDir("");
      setTriggerType("interval");
      setTriggerValue("1h");
      setModel("");
      setEnabled(true);
    }
    setError(null);
  }, [schedule, open]);

  const handlePickDirectory = useCallback(async () => {
    try {
      const res = await desktopApi().pickDirectory({
        title: text("desktop.schedule.pickWorkspace", "Select Workspace Directory")
      });
      if (res && "ok" in res && res.ok && res.path) {
        setWorkspaceDir(res.path);
      }
    } catch (err) {
      console.error("pickDirectory error:", err);
    }
  }, [text]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError(text("desktop.schedule.errorName", "Schedule name is required"));
      return;
    }
    if (!prompt.trim()) {
      setError(text("desktop.schedule.errorPrompt", "Prompt instruction is required"));
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onSave({
        name: name.trim(),
        prompt: prompt.trim(),
        workspaceDir: workspaceDir.trim() || undefined,
        model: model.trim() || undefined,
        triggerType,
        triggerValue: triggerValue.trim() || "1h",
        enabled
      });
      onClose();
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setSaving(false);
    }
  };

  const isEditing = Boolean(schedule);
  const title = isEditing
    ? text("desktop.schedule.editTitle", "Edit Schedule")
    : text("desktop.schedule.createTitle", "New Schedule");

  return (
    <Sheet open={open} title={title} onClose={onClose} modal wide>
      <form onSubmit={handleSubmit} className="schedule-form">
        {error ? <div className="schedule-form-error">{error}</div> : null}

        <div className="schedule-form-group">
          <label className="schedule-form-label">
            {text("desktop.schedule.name", "Schedule Name")} *
          </label>
          <input
            type="text"
            className="schedule-form-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={text("desktop.schedule.namePlaceholder", "e.g. Daily Code Health Check")}
            autoFocus
          />
        </div>

        <div className="schedule-form-group">
          <label className="schedule-form-label">
            {text("desktop.schedule.prompt", "Task Prompt (Instruct Thunder)")} *
          </label>
          <textarea
            className="schedule-form-textarea"
            rows={5}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={text(
              "desktop.schedule.promptPlaceholder",
              "Describe what work Thunder should perform, e.g.:\n1. Inspect git status for untracked/modified files.\n2. Run tests and report any failures.\n3. Summarize project changes in a concise report."
            )}
          />
          <span className="schedule-form-hint">
            {text(
              "desktop.schedule.promptHint",
              "Thunder will execute this instruction using its agent loop with bash, filesystem, skills, and MCP tools."
            )}
          </span>
        </div>

        <div className="schedule-form-group">
          <label className="schedule-form-label">
            {text("desktop.schedule.workspace", "Workspace Directory (CWD)")}
          </label>
          <div className="schedule-form-inline">
            <input
              type="text"
              className="schedule-form-input"
              value={workspaceDir}
              onChange={(e) => setWorkspaceDir(e.target.value)}
              placeholder={text("desktop.schedule.workspacePlaceholder", "Defaults to user home or current project")}
            />
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handlePickDirectory}
              title={text("desktop.schedule.browse", "Browse")}
            >
              <ThemeIcon name="folder-open" size={14} />
              <span>{text("desktop.schedule.browse", "Browse")}</span>
            </button>
          </div>
        </div>

        <div className="schedule-form-group">
          <label className="schedule-form-label">
            {text("desktop.schedule.frequency", "Trigger Frequency")}
          </label>
          <SegmentedControl
            value={triggerType}
            options={TRIGGER_TYPE_OPTIONS}
            onChange={(val) => {
              setTriggerType(val);
              if (val === "interval" && !triggerValue.endsWith("m") && !triggerValue.endsWith("h")) {
                setTriggerValue("1h");
              } else if (val === "daily") {
                setTriggerValue("09:00");
              } else if (val === "cron") {
                setTriggerValue("0 9 * * *");
              }
            }}
            getLabel={(val) => {
              switch (val) {
                case "interval":
                  return text("desktop.schedule.interval", "Interval");
                case "daily":
                  return text("desktop.schedule.daily", "Daily");
                case "cron":
                  return text("desktop.schedule.cron", "Cron");
                case "manual":
                  return text("desktop.schedule.manual", "Manual Only");
              }
            }}
          />

          <div className="schedule-form-trigger-config">
            {triggerType === "interval" && (
              <select
                className="schedule-form-select"
                value={triggerValue}
                onChange={(e) => setTriggerValue(e.target.value)}
              >
                {INTERVAL_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            )}

            {triggerType === "daily" && (
              <div className="schedule-form-inline">
                <input
                  type="time"
                  className="schedule-form-input schedule-time-input"
                  value={triggerValue}
                  onChange={(e) => setTriggerValue(e.target.value)}
                />
                <span className="schedule-form-hint">
                  {text("desktop.schedule.dailyHint", "Runs every day at the specified time")}
                </span>
              </div>
            )}

            {triggerType === "cron" && (
              <input
                type="text"
                className="schedule-form-input"
                value={triggerValue}
                onChange={(e) => setTriggerValue(e.target.value)}
                placeholder="0 9 * * 1-5"
              />
            )}

            {triggerType === "manual" && (
              <span className="schedule-form-hint">
                {text("desktop.schedule.manualHint", "Triggered only when you click 'Run Now'")}
              </span>
            )}
          </div>
        </div>

        <div className="schedule-form-group">
          <label className="schedule-form-label">
            {text("desktop.schedule.model", "LLM Model")}
          </label>
          {availableModels.length > 0 ? (
            <select
              className="schedule-form-select"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            >
              <option value="">{text("desktop.schedule.defaultModel", "Default (Thunder auto-select)")}</option>
              {groupedModels.panelModels.length > 0 && (
                <optgroup label={text("desktop.schedule.groupPanel", "Agent Resume Panel Models")}>
                  {groupedModels.panelModels.map((m) => (
                    <option key={m.selection_id || m.id} value={m.selection_id || m.id}>
                      {m.name || m.id} ({m.provider})
                    </option>
                  ))}
                </optgroup>
              )}
              {groupedModels.otherModels.length > 0 && (
                <optgroup label={text("desktop.schedule.groupExternal", "Pi & Global Providers")}>
                  {groupedModels.otherModels.map((m) => (
                    <option key={m.selection_id || m.id} value={m.selection_id || m.id}>
                      {m.name || m.id} ({m.provider})
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          ) : (
            <input
              type="text"
              className="schedule-form-input"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={text("desktop.schedule.modelPlaceholder", "e.g. openai/gpt-4o or claude-3-5-sonnet")}
            />
          )}
        </div>

        <div className="schedule-form-group schedule-form-checkbox-row">
          <label className="schedule-form-checkbox-label">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            <span>{text("desktop.schedule.enabledLabel", "Enable this schedule")}</span>
          </label>
        </div>

        <div className="schedule-form-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>
            {text("desktop.common.cancel", "Cancel")}
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving
              ? text("desktop.schedule.saving", "Saving…")
              : isEditing
              ? text("desktop.common.save", "Save Changes")
              : text("desktop.schedule.createBtn", "Create Schedule")}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
