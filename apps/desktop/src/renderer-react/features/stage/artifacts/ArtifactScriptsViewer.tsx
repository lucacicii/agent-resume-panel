import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ICON_SIZE, ThemeIcon } from "../../../components/ThemeIcon";
import { desktopApi } from "../../../bridge";

export interface RunnableScript {
  id: string;
  name: string;
  detail?: string;
  packageLabel?: string;
  kind?: string;
  run: {
    cwd: string;
    command: string;
  };
}

export interface ScriptPackageGroup {
  id: string;
  label: string;
  kind: string;
  packageRoot: string;
  scripts: RunnableScript[];
}

interface ScriptsViewerProps {
  payload?: {
    workspaceDir?: string;
    projects?: string[];
  } | null;
}

export function ArtifactScriptsViewer({ payload }: ScriptsViewerProps = {}): React.JSX.Element {
  const currentWorkspace = useMemo(() => {
    return (
      payload?.workspaceDir ||
      localStorage.getItem("chat-selected-workspace") ||
      localStorage.getItem("workbench-selected-project") ||
      ""
    );
  }, [payload?.workspaceDir]);

  const [packages, setPackages] = useState<ScriptPackageGroup[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [runningScriptId, setRunningScriptId] = useState<string | null>(null);

  const loadScripts = useCallback(async () => {
    const roots =
      payload?.projects && payload.projects.length > 0
        ? payload.projects.filter(Boolean)
        : currentWorkspace
          ? [currentWorkspace]
          : [];

    if (!roots.length) {
      setPackages([]);
      return;
    }

    setLoading(true);
    try {
      const results = await Promise.all(
        roots.map((root) =>
          desktopApi().workbenchListScripts?.({ rootPath: root }).catch(() => null)
        )
      );

      const groups: ScriptPackageGroup[] = [];
      for (const res of results) {
        if (!res) continue;
        const pkgs = (res as any).packages;
        if (Array.isArray(pkgs)) {
          for (const pkg of pkgs) {
            const rawScripts = pkg.scripts || [];
            if (!rawScripts.length) continue;
            const mappedScripts: RunnableScript[] = rawScripts.map((s: any) => ({
              ...s,
              packageLabel: pkg.label || pkg.kind || "",
              kind: pkg.kind
            }));
            groups.push({
              id: pkg.id || `pkg-${pkg.packageRoot}`,
              label: pkg.label || pkg.packageRoot.split("/").filter(Boolean).pop() || "project",
              kind: pkg.kind || "npm",
              packageRoot: pkg.packageRoot,
              scripts: mappedScripts
            });
          }
        }
      }
      setPackages(groups);
    } catch (err) {
      console.warn("Failed to list scripts:", err);
      setPackages([]);
    } finally {
      setLoading(false);
    }
  }, [currentWorkspace, payload?.projects]);

  useEffect(() => {
    void loadScripts();
  }, [loadScripts]);

  const filteredPackages = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return packages;
    return packages
      .map((pkg) => {
        const matchesPkg = pkg.label.toLowerCase().includes(q) || pkg.kind.toLowerCase().includes(q);
        const matchingScripts = pkg.scripts.filter(
          (s) =>
            matchesPkg ||
            s.name.toLowerCase().includes(q) ||
            s.run.command.toLowerCase().includes(q)
        );
        return {
          ...pkg,
          scripts: matchingScripts
        };
      })
      .filter((pkg) => pkg.scripts.length > 0);
  }, [packages, query]);

  const totalCount = useMemo(() => {
    return filteredPackages.reduce((acc, p) => acc + p.scripts.length, 0);
  }, [filteredPackages]);

  const handleAskAgent = (script: RunnableScript) => {
    window.dispatchEvent(
      new CustomEvent("agent-resume:composer-append", {
        detail: {
          text: `请帮我执行脚本 ${script.name} (\`${script.run.command}\`) 并分析执行结果 `
        }
      })
    );
  };

  const handleRunScript = (script: RunnableScript) => {
    setRunningScriptId(script.id);
    handleAskAgent(script);
    setTimeout(() => setRunningScriptId(null), 1000);
  };

  return (
    <div className="art-scripts-container">
      <div className="art-scripts-header">
        <div className="art-scripts-title-box">
          <ThemeIcon name="terminal" size={ICON_SIZE.default} />
          <span className="art-scripts-title">工程可执行脚本 ({totalCount})</span>
        </div>
        <div className="art-scripts-header-actions">
          <input
            type="search"
            className="art-scripts-search-input"
            value={query}
            placeholder="搜索脚本或项目..."
            aria-label="搜索脚本或项目"
            onChange={(e) => setQuery(e.target.value)}
          />
          <button
            type="button"
            className="art-note-action-btn"
            onClick={() => void loadScripts()}
            title="重新扫描脚本"
          >
            <ThemeIcon name="refresh" size={ICON_SIZE.dense} />
          </button>
        </div>
      </div>

      <div className="art-scripts-body">
        {loading ? (
          <div className="stage-artifact-empty">
            <ThemeIcon name="loader" size={ICON_SIZE.hero} className="spin" />
            <p className="stage-artifact-empty-text">正在扫描工程脚本...</p>
          </div>
        ) : filteredPackages.length === 0 ? (
          <div className="stage-artifact-empty">
            <ThemeIcon name="terminal" size={ICON_SIZE.hero} />
            <p className="stage-artifact-empty-text">未匹配到可执行脚本</p>
            <p className="art-browser-hint">
              支持扫描 package.json, Makefile, Cargo.toml, build.gradle 等清单
            </p>
          </div>
        ) : (
          <div className="art-scripts-groups-container">
            {filteredPackages.map((pkg) => (
              <div key={pkg.id} className="art-script-group-card">
                <div className="art-script-group-head">
                  <div className="art-script-group-title-box">
                    <ThemeIcon name="folder" size={ICON_SIZE.dense} />
                    <span className="art-script-group-name">{pkg.label}</span>
                    <span className="art-script-group-kind-badge">{pkg.kind}</span>
                  </div>
                  <span className="art-script-group-count">{pkg.scripts.length} 个脚本</span>
                </div>
                <div className="art-script-group-items">
                  {pkg.scripts.map((script) => {
                    const isRunning = runningScriptId === script.id;
                    return (
                      <div key={script.id} className="art-script-card">
                        <div className="art-script-head">
                          <span className="art-script-name">{script.name}</span>
                          <div className="art-script-actions">
                            <button
                              type="button"
                              className="art-note-action-btn art-note-cite-btn"
                              onClick={() => handleAskAgent(script)}
                              title="带入对话提问 Agent"
                            >
                              <ThemeIcon name="message-square-plus" size={ICON_SIZE.inline} />
                              <span>提问</span>
                            </button>
                            <button
                              type="button"
                              className="art-script-run-btn"
                              onClick={() => void handleRunScript(script)}
                              disabled={isRunning}
                              title="在后台执行此脚本"
                            >
                              <ThemeIcon
                                name={isRunning ? "loader" : "play"}
                                size={ICON_SIZE.inline}
                                className={isRunning ? "spin" : undefined}
                              />
                              <span>{isRunning ? "执行中" : "运行"}</span>
                            </button>
                          </div>
                        </div>
                        <pre className="art-script-cmd">{script.run.command}</pre>
                        <div className="art-script-foot">
                          <span>工作目录: {script.run.cwd.split("/").filter(Boolean).pop()}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
