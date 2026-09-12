import { useCallback, useEffect, useState } from "react";
import { desktopApi } from "../../../bridge";
import { type ScriptEntryView, type ScriptPackageView } from "../ScriptsTree";

function statusError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error invoking remote method '[^']+': Error:\s*/, "");
}

export function useWorkbenchScripts(options: {
  active: boolean;
  selectedProject: string | null;
  side: string | null;
  runScript: (script: ScriptEntryView, pkg: ScriptPackageView) => void;
}): {
  scriptPackages: ScriptPackageView[];
  scriptsLoading: boolean;
  scriptsError: string;
  scriptsTruncated: boolean;
  scriptsSectionCollapsed: boolean;
  loadScripts: (rootPath: string) => Promise<void>;
  runScript: (script: ScriptEntryView, pkg: ScriptPackageView) => void;
  toggleScriptsSectionCollapsed: () => void;
} {
  const { active, selectedProject, side, runScript } = options;
  const [scriptPackages, setScriptPackages] = useState<ScriptPackageView[]>([]);
  const [scriptsLoading, setScriptsLoading] = useState(false);
  const [scriptsError, setScriptsError] = useState("");
  const [scriptsTruncated, setScriptsTruncated] = useState(false);
  const [scriptsSectionCollapsed, setScriptsSectionCollapsed] = useState(() => {
    try { return localStorage.getItem("wb-scripts-collapsed") === "true"; } catch { return false; }
  });

  const loadScripts = useCallback(async (rootPath: string) => {
    setScriptsLoading(true);
    setScriptsError("");
    try {
      const result = await desktopApi().workbenchListScripts({ rootPath });
      setScriptPackages(result.packages);
      setScriptsTruncated(Boolean(result.truncated));
    } catch (error) {
      setScriptPackages([]);
      setScriptsTruncated(false);
      setScriptsError(statusError(error));
    } finally {
      setScriptsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!active || !selectedProject) {
      setScriptPackages([]);
      setScriptsError("");
      setScriptsTruncated(false);
      return;
    }
    if (side === "files" || side === "scripts") {
      void loadScripts(selectedProject);
    }
  }, [active, loadScripts, selectedProject, side]);

  const toggleScriptsSectionCollapsed = useCallback(() => {
    setScriptsSectionCollapsed((current) => {
      const next = !current;
      localStorage.setItem("wb-scripts-collapsed", String(next));
      return next;
    });
  }, []);

  return {
    scriptPackages,
    scriptsLoading,
    scriptsError,
    scriptsTruncated,
    scriptsSectionCollapsed,
    loadScripts,
    runScript,
    toggleScriptsSectionCollapsed
  };
}
