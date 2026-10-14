import { useCallback, useEffect, useMemo, useState } from "react";
import { Sheet } from "../../components/Sheet";
import { ICON_SIZE, ThemeIcon } from "../../components/ThemeIcon";
import { SegmentedControl } from "../../components/SegmentedControl";
import { desktopApi } from "../../bridge";
import { useI18n } from "../../i18n";
import type {
  ThunderSchedule,
  ThunderScheduleInput,
  ScheduleTriggerType,
  ScheduleCatchUpPolicy,
  ScheduleSessionMode,
  ThunderModelInfo
} from "@agent-resume/core";
import { computeNextRun, validateCron } from "../../../shared/scheduleTriggers";

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

const CATCH_UP_OPTIONS: ScheduleCatchUpPolicy[] = ["skip", "once", "all"];
const SESSION_MODE_OPTIONS: ScheduleSessionMode[] = ["pinned", "fresh"];

export function ScheduleEditorSheet({
  open,
  schedule,
  onClose,
  onSave
}: ScheduleEditorSheetProps) {
  const { ready, t } = useI18n();
  const text = (key: string, fallback: string, ...args: Array<string | number>) =>
    ready ? t(key, ...args) : fallback.replace("{0}", String(args[0] ?? ""));

  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [workspaceDir, setWorkspaceDir] = useState("");
  const [triggerType, setTriggerType] = useState<ScheduleTriggerType>("interval");
  const [triggerValue, setTriggerValue] = useState("1h");
  const [model, setModel] = useState("");
  const [catchUp, setCatchUp] = useState<ScheduleCatchUpPolicy>("skip");
  const [sessionMode, setSessionMode] = useState<ScheduleSessionMode>("pinned");
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
      setCatchUp(schedule.catchUp || "skip");
      setSessionMode(schedule.sessionMode || "pinned");
      setEnabled(schedule.enabled);
    } else {
      setName("");
      setPrompt("");
      setWorkspaceDir("");
      setTriggerType("interval");
      setTriggerValue("1h");
      setModel("");
      setCatchUp("skip");
      setSessionMode("pinned");
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
    if (triggerType === "cron") {
      const parsed = validateCron(triggerValue);
      if (!parsed.ok) {
        setError(
          text("desktop.schedule.errorCron", "Invalid cron expression: {0}", parsed.error || "")
        );
        return;
      }
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
        catchUp,
        sessionMode,
        enabled
      });
      onClose();
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setSaving(false);
    }
  };

  /**
   * Live cron feedback.
   *
   * The scheduler used to treat every cron expression as "in one hour", so a
   * typo was invisible until the schedule did something surprising. Validating
   * here — with the next fire time shown — makes the expression's meaning
   * legible before saving.
   */
  const cronValidation = useMemo(
    () => (triggerType === "cron" ? validateCron(triggerValue) : { ok: true as const }),
    [triggerType, triggerValue]
  );
  const cronError = cronValidation.ok ? null : cronValidation.error ?? "";

  const nextRunPreview = useMemo(() => {
    if (triggerType === "manual" || !cronValidation.ok) return null;
    if (triggerType === "cron" && !triggerValue.trim()) return null;
    const next = computeNextRun(triggerType, triggerValue);
    return next ? new Date(next).toLocaleString() : null;
  }, [triggerType, triggerValue, cronValidation.ok]);

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
              <ThemeIcon name="folder-open" size={ICON_SIZE.dense} />
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
              <div className="schedule-form-cron">
                <input
                  type="text"
                  className={`schedule-form-input${
                    cronError ? " schedule-form-input-invalid" : ""
                  }`}
                  value={triggerValue}
                  onChange={(e) => setTriggerValue(e.target.value)}
                  placeholder="0 9 * * 1-5"
                />
                {cronError ? (
                  <span className="schedule-form-hint schedule-form-hint-error">
                    {text("desktop.schedule.cronInvalid", "Not a valid cron expression: {0}", cronError)}
                  </span>
                ) : (
                  <span className="schedule-form-hint">
                    {nextRunPreview
                      ? text("desktop.schedule.cronNext", "Next run: {0}", nextRunPreview)
                      : text(
                          "desktop.schedule.cronHint",
                          "Standard 5-field cron (minute hour day month weekday)."
                        )}
                  </span>
                )}
              </div>
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

        <div className="schedule-form-group">
          <label className="schedule-form-label">
            {text("desktop.schedule.sessionMode", "Session")}
          </label>
          <SegmentedControl
            value={sessionMode}
            options={SESSION_MODE_OPTIONS}
            onChange={(val) => setSessionMode(val)}
            getLabel={(val) => {
              switch (val) {
                case "pinned":
                  return text("desktop.schedule.sessionPinned", "Continue one session");
                case "fresh":
                  return text("desktop.schedule.sessionFresh", "New session each run");
              }
            }}
          />
          <span className="schedule-form-hint">
            {sessionMode === "pinned"
              ? text(
                  "desktop.schedule.sessionPinnedHint",
                  "Runs share one Thunder conversation: prior context carries over and the prompt cache stays warm."
                )
              : text(
                  "desktop.schedule.sessionFreshHint",
                  "Every run starts from an empty conversation, so runs cannot influence each other."
                )}
          </span>
        </div>

        {triggerType !== "manual" && (
          <div className="schedule-form-group">
            <label className="schedule-form-label">
              {text("desktop.schedule.catchUp", "If runs were missed")}
            </label>
            <SegmentedControl
              value={catchUp}
              options={CATCH_UP_OPTIONS}
              onChange={(val) => setCatchUp(val)}
              getLabel={(val) => {
                switch (val) {
                  case "skip":
                    return text("desktop.schedule.catchUpSkip", "Skip");
                  case "once":
                    return text("desktop.schedule.catchUpOnce", "Run the latest");
                  case "all":
                    return text("desktop.schedule.catchUpAll", "Run all");
                }
              }}
            />
            <span className="schedule-form-hint">
              {catchUp === "skip"
                ? text(
                    "desktop.schedule.catchUpSkipHint",
                    "Trigger points that passed while the app was closed are dropped. Best for inspections, where a stale run has no value."
                  )
                : catchUp === "once"
                  ? text(
                      "desktop.schedule.catchUpOnceHint",
                      "Only the most recent missed trigger point runs, so a daily schedule never replays a whole week."
                    )
                  : text(
                      "desktop.schedule.catchUpAllHint",
                      "Every missed trigger point runs in order. Only use this for work that is safe to repeat."
                    )}
            </span>
          </div>
        )}

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
