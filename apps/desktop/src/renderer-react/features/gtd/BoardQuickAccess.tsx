import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { desktopApi } from "../../bridge";
import { useI18n } from "../../i18n";
import { QuickAccess, type QuickAccessCommand } from "../workbench/QuickAccess";
import { taskFromRecord } from "../workbench/task";
import { ensureTaskWorkbenches } from "../workbench/workbenchModel";

/**
 * Command palette for the board window.
 *
 * The full workbench palette lives with the workbench, so the board gets a small
 * one: start a task, jump into the window of any task, or open settings. Shortcuts
 * are handled here because the board window installs no workbench shortcuts.
 */
export function BoardQuickAccess(): React.ReactPortal | null {
  const host = document.getElementById("react-gtd");
  const { t, ready } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [commands, setCommands] = useState<QuickAccessCommand[]>([]);
  const [loading, setLoading] = useState(false);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);

  const loadCommands = useCallback(async (): Promise<QuickAccessCommand[]> => {
    const text = (key: string) => (ready ? t(key) : key);
    const base: QuickAccessCommand[] = [
      {
        id: "task.new",
        label: text("desktop.gtd.newTask"),
        category: text("desktop.workbench.quickAccessCategoryTasks"),
        keywords: "new task create gtd",
        run: () => { window.dispatchEvent(new Event("agent-resume:gtd-new-task")); }
      },
      {
        id: "settings.open",
        label: text("desktop.top.settings"),
        category: text("desktop.workbench.quickAccessCategoryApplication"),
        keywords: "settings preferences",
        run: () => { window.dispatchEvent(new CustomEvent("agent-resume:settings-open", { detail: "general" })); }
      }
    ];
    try {
      const records = typeof desktopApi().notesListTasks === "function" ? await desktopApi().notesListTasks() : [];
      const tasks = records.map((record) => taskFromRecord(record)).slice(0, 100);
      return [
        ...base,
        ...tasks.map((task): QuickAccessCommand => ({
          id: `task.open.${task.noteId}`,
          label: task.title,
          detail: task.next ? `${text("desktop.workbench.taskNext")} ${task.next}` : undefined,
          category: text("desktop.workbench.quickAccessCategoryTasks"),
          keywords: `open task window ${task.title}`,
          run: async () => {
            const workbenches = await ensureTaskWorkbenches(task.noteId);
            const workbenchId = workbenches[0]?.workbenchId;
            if (!workbenchId) return;
            await desktopApi().taskWindowOpen({ noteId: task.noteId, workbenchId, title: task.title });
          }
        }))
      ];
    } catch {
      return base;
    }
  }, [ready, t]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      if (event.key.toLowerCase() !== "p") return;
      // ⌘P and ⌘⇧P both open the palette here: the board has no files to find.
      event.preventDefault();
      setOpen(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    void loadCommands()
      .then((next) => { if (!cancelled) setCommands(next); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, loadCommands]);

  if (!host || !open) return null;

  return createPortal(
    <QuickAccess
      open={open}
      mode="commands"
      query={query}
      files={[]}
      commands={commands}
      recentPaths={[]}
      loading={loading}
      truncated={false}
      error=""
      hasProject
      labels={{
        filePlaceholder: t("desktop.workbench.quickAccessFilePlaceholder"),
        commandPlaceholder: t("desktop.workbench.quickAccessCommandPlaceholder"),
        loading: t("desktop.workbench.quickAccessLoading"),
        noFiles: t("desktop.workbench.quickAccessNoFiles"),
        noCommands: t("desktop.workbench.quickAccessNoCommands"),
        noProject: t("desktop.workbench.quickAccessNoProject"),
        truncated: t("desktop.workbench.quickAccessTruncated"),
        close: t("desktop.workbench.quickAccessClose"),
        dialog: t("desktop.workbench.quickAccessDialog")
      }}
      onModeChange={() => undefined}
      onQueryChange={setQuery}
      onClose={close}
      onOpenFile={() => undefined}
      onOpenDirectory={() => undefined}
    />,
    host
  );
}
