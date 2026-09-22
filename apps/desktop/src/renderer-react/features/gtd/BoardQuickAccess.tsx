import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { desktopApi } from "../../bridge";
import { useI18n } from "../../i18n";
import { useOverlayPresence } from "../../components/useOverlayMotion";
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
  // The palette is a fixed overlay, so it portals to the body: it must stay
  // visible whichever board view is showing (`#react-gtd` is hidden in Notes).
  const host = document.body;
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
        id: "view.gtd",
        label: text("desktop.workbench.quickAccessShowGtd"),
        category: text("desktop.workbench.quickAccessCategoryNavigation"),
        keywords: "view gtd board tasks kanban switch surface",
        run: () => { window.dispatchEvent(new CustomEvent("agent-resume:board-view", { detail: "gtd" })); }
      },
      {
        id: "view.notes",
        label: text("desktop.workbench.quickAccessShowNotes"),
        category: text("desktop.workbench.quickAccessCategoryNavigation"),
        keywords: "view notes switch surface markdown",
        run: () => { window.dispatchEvent(new CustomEvent("agent-resume:board-view", { detail: "notes" })); }
      },
      {
        id: "view.archive",
        label: text("desktop.workbench.quickAccessShowArchive"),
        category: text("desktop.workbench.quickAccessCategoryNavigation"),
        keywords: "view archive filed away done switch surface",
        run: () => { window.dispatchEvent(new CustomEvent("agent-resume:board-view", { detail: "archive" })); }
      },
      {
        id: "view.sessions",
        label: text("desktop.workbench.quickAccessShowSessions"),
        category: text("desktop.workbench.quickAccessCategoryNavigation"),
        keywords: "view sessions history catalog switch surface",
        run: () => { window.dispatchEvent(new CustomEvent("agent-resume:board-view", { detail: "sessions" })); }
      },
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
        run: () => { void desktopApi().openSettingsWindow?.({ pane: "general" }).catch(() => undefined); }
      }
    ];
    try {
      const records = typeof desktopApi().notesListTasks === "function" ? await desktopApi().notesListTasks() : [];
      const tasks = records
        .map((record) => taskFromRecord(record))
        .filter((task) => task.archivedAtMs == null)
        .slice(0, 100);
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

  // `QuickAccess` runs its own exit animation; the portal has to stay mounted for
  // it. Gating the portal on `open` alone would unmount the palette instantly.
  const presence = useOverlayPresence(open);

  if (!host || !presence.mounted) return null;

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
