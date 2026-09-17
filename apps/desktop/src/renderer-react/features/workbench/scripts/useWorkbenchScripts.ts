import { useCallback, useEffect, useRef, useState } from "react";
import { desktopApi } from "../../../bridge";
import { type ScriptEntryView, type ScriptPackageView } from "../ScriptsTree";

function statusError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error invoking remote method '[^']+': Error:\s*/, "");
}

/** Last segment of a project root, for disambiguating multi-root script groups. */
function rootBasename(value = ""): string {
  return value.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) || value;
}

export function useWorkbenchScripts(options: {
  active: boolean;
  projects: string[];
  side: string | null;
  runScript: (script: ScriptEntryView, pkg: ScriptPackageView) => void;
}): {
  scriptPackages: ScriptPackageView[];
  scriptsLoading: boolean;
  scriptsError: string;
  scriptsTruncated: boolean;
  scriptsSectionCollapsed: boolean;
  loadScripts: () => Promise<void>;
  runScript: (script: ScriptEntryView, pkg: ScriptPackageView) => void;
  toggleScriptsSectionCollapsed: () => void;
} {
  const { active, projects, side, runScript } = options;
  const [scriptPackages, setScriptPackages] = useState<ScriptPackageView[]>([]);
  const [scriptsLoading, setScriptsLoading] = useState(false);
  const [scriptsError, setScriptsError] = useState("");
  const [scriptsTruncated, setScriptsTruncated] = useState(false);
  const [scriptsSectionCollapsed, setScriptsSectionCollapsed] = useState(() => {
    try { return localStorage.getItem("wb-scripts-collapsed") === "true"; } catch { return false; }
  });
  const projectsRef = useRef(projects);
  projectsRef.current = projects;
  /** Stable identity of the project root set, used to reset/reload per workspace. */
  const projectsKey = projects.map((project) => project.replaceAll("\\", "/").replace(/\/+$/, "")).join("\0");

  const loadScripts = useCallback(async () => {
    const roots = projectsRef.current;
    if (!roots.length) {
      setScriptPackages([]);
      setScriptsError("");
      setScriptsTruncated(false);
      return;
    }
    setScriptsLoading(true);
    setScriptsError("");
    try {
      const results = await Promise.all(roots.map((root) => desktopApi().workbenchListScripts({ rootPath: root })));
      const multiRoot = roots.length > 1;
      const packages: ScriptPackageView[] = [];
      let truncated = false;
      roots.forEach((root, index) => {
        const result = results[index];
        if (!result) return;
        truncated = truncated || Boolean(result.truncated);
        if (!multiRoot) {
          packages.push(...result.packages);
          return;
        }
        const prefix = rootBasename(root);
        for (const pkg of result.packages) {
          packages.push({
            ...pkg,
            relativeRoot: pkg.relativeRoot ? `${prefix}/${pkg.relativeRoot}` : prefix,
            label: pkg.label === prefix ? pkg.label : `${prefix} · ${pkg.label}`
          });
        }
      });
      setScriptPackages(packages);
      setScriptsTruncated(truncated);
    } catch (error) {
      setScriptPackages([]);
      setScriptsTruncated(false);
      setScriptsError(statusError(error));
    } finally {
      setScriptsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!active || !projectsKey) {
      setScriptPackages([]);
      setScriptsError("");
      setScriptsTruncated(false);
      return;
    }
    if (side === "files" || side === "scripts") {
      void loadScripts();
    }
  }, [active, loadScripts, projectsKey, side]);

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
