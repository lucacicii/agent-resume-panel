import React, { useCallback, useEffect, useState } from "react";
import { ICON_SIZE, ThemeIcon } from "../../../components/ThemeIcon";
import { desktopApi } from "../../../bridge";

export interface RunnableScript {
  id: string;
  name: string;
  detail?: string;
  run: {
    cwd: string;
    command: string;
  };
}

export function ArtifactScriptsViewer(): React.JSX.Element {
  const [workspaceDir] = useState<string>(() => {
    return (
      localStorage.getItem("chat-selected-workspace") ||
      localStorage.getItem("workbench-selected-project") ||
      ""
    );
  });
  const [scripts, setScripts] = useState<RunnableScript[]>([]);
  const [loading, setLoading] = useState(false);
  const [runningScriptId, setRunningScriptId] = useState<string | null>(null);

  const loadScripts = useCallback(async () => {
    if (!workspaceDir) return;
    setLoading(true);
    try {
      const res = await desktopApi().workbenchListScripts?.({
        rootPath: workspaceDir
      });
      if (Array.isArray(res) && res.length > 0) {
        const all = res.flatMap((r) => r.scripts || []);
        setScripts(all);
      }
    } catch (err) {
      console.warn("Failed to list scripts:", err);
    } finally {
      setLoading(false);
    }
  }, [workspaceDir]);

  useEffect(() => {
    void loadScripts();
  }, [loadScripts]);

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
          <span className="art-scripts-title">工程可执行脚本 ({scripts.length})</span>
        </div>
        <button
          type="button"
          className="art-note-action-btn"
          onClick={() => void loadScripts()}
          title="重新扫描脚本"
        >
          <ThemeIcon name="refresh" size={ICON_SIZE.dense} />
        </button>
      </div>

      <div className="art-scripts-body">
        {loading ? (
          <div className="stage-artifact-empty">
            <ThemeIcon name="loader" size={ICON_SIZE.hero} className="spin" />
            <p className="stage-artifact-empty-text">正在扫描工程脚本...</p>
          </div>
        ) : scripts.length === 0 ? (
          <div className="stage-artifact-empty">
            <ThemeIcon name="terminal" size={ICON_SIZE.hero} />
            <p className="stage-artifact-empty-text">当前工程根目录未扫描到脚本配置</p>
            <p className="art-browser-hint">支持 package.json, Makefile, Cargo.toml, build.gradle 等</p>
          </div>
        ) : (
          <div className="art-scripts-list">
            {scripts.map((script) => {
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
                    <span>路径: {script.run.cwd.split("/").filter(Boolean).pop()}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
