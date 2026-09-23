import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ICON_SIZE, ThemeIcon } from "../../components/ThemeIcon";
import { SegmentedControl } from "../../components/SegmentedControl";
import { StreamdownRenderer } from "../../components/StreamdownRenderer";
import { desktopApi } from "../../bridge";
import { useI18n } from "../../i18n";
import { ScheduleEditorSheet } from "./ScheduleEditorSheet";
import { ScheduleLiveRun } from "./ScheduleLiveRun";
import { ScheduleHistory } from "./ScheduleHistory";
import type { ThunderSchedule, ThunderScheduleInput } from "@agent-resume/core";

type FilterStatus = "all" | "active" | "paused";
type DetailTab = "overview" | "live" | "history";

const FILTER_OPTIONS: FilterStatus[] = ["all", "active", "paused"];
const TAB_OPTIONS: DetailTab[] = ["overview", "live", "history"];

export function ScheduleView({ active }: { active: boolean }): React.JSX.Element | null {
  const host = document.getElementById("react-schedule");
  const { ready, t } = useI18n();
  const text = (key: string, fallback: string) => (ready ? t(key) : fallback);

  const [schedules, setSchedules] = useState<ThunderSchedule[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterStatus>("all");
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<DetailTab>("overview");

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<ThunderSchedule | null>(null);

  const [activeRunningMap, setActiveRunningMap] = useState<Record<string, string>>({}); // scheduleId -> runId
  const [loading, setLoading] = useState(true);

  const loadSchedules = useCallback(async () => {
    try {
      setLoading(true);
      const list = await desktopApi().schedulesList();
      setSchedules(list);
      if (list.length > 0 && !selectedId) {
        setSelectedId(list[0].id);
      }
    } catch (err) {
      console.error("Failed to load schedules:", err);
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    if (!active) return;
    void loadSchedules();
  }, [active, loadSchedules]);

  useEffect(() => {
    const unsub = desktopApi().onScheduleStatusChanged?.((payload) => {
      if (payload.status === "running") {
        setActiveRunningMap((prev) => ({ ...prev, [payload.scheduleId]: payload.runId }));
      } else {
        setActiveRunningMap((prev) => {
          const next = { ...prev };
          delete next[payload.scheduleId];
          return next;
        });
      }
      void loadSchedules();
    });
    return () => unsub?.();
  }, [loadSchedules]);

  const selectedSchedule = useMemo(() => {
    return schedules.find((s) => s.id === selectedId) || null;
  }, [schedules, selectedId]);

  const filteredSchedules = useMemo(() => {
    const query = search.trim().toLowerCase();
    return schedules.filter((s) => {
      if (filter === "active" && !s.enabled) return false;
      if (filter === "paused" && s.enabled) return false;
      if (!query) return true;
      return (
        s.name.toLowerCase().includes(query) ||
        s.prompt.toLowerCase().includes(query) ||
        (s.workspaceDir && s.workspaceDir.toLowerCase().includes(query))
      );
    });
  }, [schedules, filter, search]);

  const handleCreate = () => {
    setEditingSchedule(null);
    setEditorOpen(true);
  };

  const handleEdit = (schedule: ThunderSchedule) => {
    setEditingSchedule(schedule);
    setEditorOpen(true);
  };

  const handleDelete = async (schedule: ThunderSchedule) => {
    if (!confirm(text("desktop.schedule.confirmDelete", "Are you sure you want to delete this schedule?"))) {
      return;
    }
    try {
      await desktopApi().schedulesDelete({ id: schedule.id });
      if (selectedId === schedule.id) {
        setSelectedId(null);
      }
      void loadSchedules();
    } catch (err) {
      console.error("Failed to delete schedule:", err);
    }
  };

  const handleToggle = async (schedule: ThunderSchedule) => {
    try {
      await desktopApi().schedulesToggle({ id: schedule.id, enabled: !schedule.enabled });
      void loadSchedules();
    } catch (err) {
      console.error("Failed to toggle schedule:", err);
    }
  };

  const handleRunNow = async (schedule: ThunderSchedule) => {
    try {
      setActiveTab("live");
      const res = await desktopApi().schedulesRunNow({ id: schedule.id });
      setActiveRunningMap((prev) => ({ ...prev, [schedule.id]: res.runId }));
    } catch (err: any) {
      alert(`Run failed: ${err?.message || String(err)}`);
    }
  };

  const handleSaveSchedule = async (input: ThunderScheduleInput) => {
    if (editingSchedule) {
      await desktopApi().schedulesUpdate({ id: editingSchedule.id, input });
    } else {
      const created = await desktopApi().schedulesCreate({ input });
      setSelectedId(created.id);
    }
    void loadSchedules();
  };

  const formatTriggerDesc = (s: ThunderSchedule) => {
    switch (s.triggerType) {
      case "interval":
        return `Every ${s.triggerValue}`;
      case "daily":
        return `Daily at ${s.triggerValue}`;
      case "cron":
        return `Cron (${s.triggerValue})`;
      case "manual":
        return "Manual only";
    }
  };

  if (!host || !active) return null;

  return createPortal(
    <div className="schedule-view">
      {/* Left List Pane */}
      <div className="schedule-view-list">
        <div className="schedule-view-search">
          <ThemeIcon name="search" size={ICON_SIZE.dense} />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={text("desktop.schedule.searchPlaceholder", "Search schedules…")}
          />
          <button
            type="button"
            className="icon-btn btn-primary-accent"
            onClick={handleCreate}
            title={text("desktop.schedule.addSchedule", "Add Schedule")}
          >
            <ThemeIcon name="plus" size={ICON_SIZE.dense} />
          </button>
        </div>

        <div className="schedule-filter-bar">
          <SegmentedControl
            value={filter}
            options={FILTER_OPTIONS}
            onChange={setFilter}
            getLabel={(opt) => {
              switch (opt) {
                case "all":
                  return text("desktop.schedule.filterAll", "All");
                case "active":
                  return text("desktop.schedule.filterActive", "Active");
                case "paused":
                  return text("desktop.schedule.filterPaused", "Paused");
              }
            }}
          />
        </div>

        <div className="schedule-list-items">
          {loading ? (
            <div className="schedule-list-loading">
              <ThemeIcon name="loader" size={ICON_SIZE.default} />
              <span>{text("desktop.top.loading", "Loading…")}</span>
            </div>
          ) : filteredSchedules.length === 0 ? (
            <div className="schedule-list-empty">
              <ThemeIcon name="clock" size={ICON_SIZE.hero} />
              <p>{text("desktop.schedule.emptyList", "No schedules found.")}</p>
              <button type="button" className="btn btn-secondary btn-sm" onClick={handleCreate}>
                <ThemeIcon name="plus" size={ICON_SIZE.inline} />
                <span>{text("desktop.schedule.createFirst", "Create Schedule")}</span>
              </button>
            </div>
          ) : (
            filteredSchedules.map((s) => {
              const isSelected = s.id === selectedId;
              const isRunning = Boolean(activeRunningMap[s.id] || s.lastStatus === "running");

              return (
                <div
                  key={s.id}
                  className={`schedule-list-card${isSelected ? " is-active" : ""}`}
                  onClick={() => setSelectedId(s.id)}
                >
                  <div className="schedule-card-header">
                    <div className="schedule-card-title-row">
                      <span
                        className={`schedule-dot ${
                          isRunning
                            ? "schedule-dot-running"
                            : s.lastStatus === "success"
                            ? "schedule-dot-success"
                            : s.lastStatus === "failed"
                            ? "schedule-dot-failed"
                            : "schedule-dot-idle"
                        }`}
                        title={isRunning ? "Running" : s.lastStatus || "Idle"}
                      />
                      <span className="schedule-card-title">{s.name}</span>
                    </div>

                    <button
                      type="button"
                      className="icon-btn schedule-quick-run-btn"
                      title={text("desktop.schedule.runNow", "Run Now")}
                      disabled={isRunning}
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleRunNow(s);
                      }}
                    >
                      <ThemeIcon name={isRunning ? "loader" : "play"} size={ICON_SIZE.inline} />
                    </button>
                  </div>

                  <div className="schedule-card-info">
                    <span className="schedule-card-badge">{formatTriggerDesc(s)}</span>
                    {!s.enabled && (
                      <span className="schedule-card-badge schedule-card-badge-paused">
                        {text("desktop.schedule.paused", "Paused")}
                      </span>
                    )}
                  </div>

                  {s.workspaceDir && (
                    <div className="schedule-card-workspace" title={s.workspaceDir}>
                      <ThemeIcon name="folder" size={ICON_SIZE.inline} />
                      <span>{s.workspaceDir}</span>
                    </div>
                  )}

                  {s.nextRunAtMs && s.enabled && (
                    <div className="schedule-card-next-run">
                      Next: {new Date(s.nextRunAtMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Right Detail Pane */}
      <div className="schedule-view-detail">
        {selectedSchedule ? (
          <div className="schedule-detail-container">
            {/* Header / Actions */}
            <div className="schedule-detail-header">
              <div className="schedule-detail-title-section">
                <div className="schedule-detail-title-row">
                  <h2>{selectedSchedule.name}</h2>
                  <span
                    className={`schedule-status-badge schedule-status-${
                      activeRunningMap[selectedSchedule.id]
                        ? "running"
                        : selectedSchedule.lastStatus || "idle"
                    }`}
                  >
                    {activeRunningMap[selectedSchedule.id]
                      ? "RUNNING"
                      : (selectedSchedule.lastStatus || "IDLE").toUpperCase()}
                  </span>
                </div>
                <div className="schedule-detail-meta-row">
                  <span className="schedule-detail-frequency">
                    <ThemeIcon name="clock" size={ICON_SIZE.inline} />
                    {formatTriggerDesc(selectedSchedule)}
                  </span>
                  {selectedSchedule.workspaceDir && (
                    <span className="schedule-detail-cwd">
                      <ThemeIcon name="folder" size={ICON_SIZE.inline} />
                      {selectedSchedule.workspaceDir}
                    </span>
                  )}
                  {selectedSchedule.model && (
                    <span className="schedule-detail-model">
                      <ThemeIcon name="bot" size={ICON_SIZE.inline} />
                      {selectedSchedule.model}
                    </span>
                  )}
                </div>
              </div>

              <div className="schedule-detail-toolbar">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={Boolean(activeRunningMap[selectedSchedule.id])}
                  onClick={() => void handleRunNow(selectedSchedule)}
                  title={text("desktop.schedule.runNow", "Run Now with Thunder")}
                >
                  <ThemeIcon
                    name={activeRunningMap[selectedSchedule.id] ? "loader" : "play"}
                    size={ICON_SIZE.dense}
                  />
                  <span>
                    {activeRunningMap[selectedSchedule.id]
                      ? text("desktop.schedule.running", "Running…")
                      : text("desktop.schedule.runNow", "Run Now")}
                  </span>
                </button>

                <button
                  type="button"
                  className={`btn ${selectedSchedule.enabled ? "btn-secondary" : "btn-primary-ghost"}`}
                  onClick={() => void handleToggle(selectedSchedule)}
                >
                  {selectedSchedule.enabled
                    ? text("desktop.schedule.pause", "Pause")
                    : text("desktop.schedule.resume", "Enable")}
                </button>

                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => handleEdit(selectedSchedule)}
                  title={text("desktop.top.edit", "Edit")}
                >
                  <ThemeIcon name="pencil" size={ICON_SIZE.dense} />
                </button>

                <button
                  type="button"
                  className="icon-btn icon-btn-danger"
                  onClick={() => void handleDelete(selectedSchedule)}
                  title={text("desktop.top.delete", "Delete")}
                >
                  <ThemeIcon name="trash" size={ICON_SIZE.dense} />
                </button>
              </div>
            </div>

            {/* Navigation Tabs */}
            <div className="schedule-detail-tabs">
              <SegmentedControl
                value={activeTab}
                options={TAB_OPTIONS}
                onChange={setActiveTab}
                getLabel={(tab) => {
                  switch (tab) {
                    case "overview":
                      return text("desktop.schedule.tabOverview", "Overview");
                    case "live":
                      return text("desktop.schedule.tabLive", "Live Execution");
                    case "history":
                      return text("desktop.schedule.tabHistory", "History");
                  }
                }}
              />
            </div>

            {/* Tab Contents */}
            <div className="schedule-tab-content">
              {activeTab === "overview" && (
                <div className="schedule-overview-pane">
                  <div className="schedule-card schedule-prompt-card">
                    <div className="schedule-card-topbar">
                      <span className="schedule-card-heading">
                        {text("desktop.schedule.taskPrompt", "Task Instructions")}
                      </span>
                    </div>
                    <div className="schedule-prompt-content">
                      <pre>{selectedSchedule.prompt}</pre>
                    </div>
                  </div>

                  <div className="schedule-card schedule-info-grid">
                    <div className="schedule-info-item">
                      <label>{text("desktop.schedule.workspace", "Workspace")}</label>
                      <span>{selectedSchedule.workspaceDir || "Default"}</span>
                    </div>
                    <div className="schedule-info-item">
                      <label>{text("desktop.schedule.model", "Model")}</label>
                      <span>{selectedSchedule.model || "Thunder Default"}</span>
                    </div>
                    <div className="schedule-info-item">
                      <label>{text("desktop.schedule.triggerRule", "Trigger Rule")}</label>
                      <span>{formatTriggerDesc(selectedSchedule)}</span>
                    </div>
                    <div className="schedule-info-item">
                      <label>{text("desktop.schedule.lastRunAt", "Last Execution")}</label>
                      <span>
                        {selectedSchedule.lastRunAtMs
                          ? new Date(selectedSchedule.lastRunAtMs).toLocaleString()
                          : "Never"}
                      </span>
                    </div>
                    <div className="schedule-info-item">
                      <label>{text("desktop.schedule.nextRunAt", "Next Execution")}</label>
                      <span>
                        {selectedSchedule.nextRunAtMs && selectedSchedule.enabled
                          ? new Date(selectedSchedule.nextRunAtMs).toLocaleString()
                          : "Disabled"}
                      </span>
                    </div>
                  </div>

                  {selectedSchedule.lastOutput && (
                    <div className="schedule-card schedule-last-output-card">
                      <div className="schedule-card-topbar">
                        <span className="schedule-card-heading">
                          {text("desktop.schedule.latestOutput", "Latest Result")}
                        </span>
                      </div>
                      <div className="schedule-last-output-markdown">
                        <StreamdownRenderer content={selectedSchedule.lastOutput} />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {activeTab === "live" && (
                <ScheduleLiveRun
                  schedule={selectedSchedule}
                  activeRunId={activeRunningMap[selectedSchedule.id] || null}
                  onRunFinished={() => void loadSchedules()}
                />
              )}

              {activeTab === "history" && (
                <ScheduleHistory schedule={selectedSchedule} />
              )}
            </div>
          </div>
        ) : (
          <div className="schedule-empty-state">
            <ThemeIcon name="clock" size={ICON_SIZE.hero} />
            <h3>{text("desktop.schedule.noSelectedTitle", "No Schedule Selected")}</h3>
            <p>
              {text(
                "desktop.schedule.noSelectedDesc",
                "Choose a schedule from the list on the left or create a new one to automate tasks with Thunder Agent."
              )}
            </p>
            <button type="button" className="btn btn-primary" onClick={handleCreate}>
              <ThemeIcon name="plus" size={ICON_SIZE.dense} />
              <span>{text("desktop.schedule.addSchedule", "Add Schedule")}</span>
            </button>
          </div>
        )}
      </div>

      {/* Editor Modal */}
      <ScheduleEditorSheet
        open={editorOpen}
        schedule={editingSchedule}
        onClose={() => setEditorOpen(false)}
        onSave={handleSaveSchedule}
      />
    </div>,
    host
  );
}
