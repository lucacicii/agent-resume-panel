import React, { useCallback, useEffect, useState } from "react";
import { ICON_SIZE, ThemeIcon } from "../../../components/ThemeIcon";
import { desktopApi } from "../../../bridge";

interface DiffViewerProps {
  payload?: {
    workspaceDir?: string;
    files?: Array<{ path: string; status: "modified" | "added" | "deleted" }>;
    diffText?: string;
  } | null;
}

interface GitFileInfo {
  path: string;
  status: "M" | "A" | "D";
}

export function ArtifactDiffViewer({ payload }: DiffViewerProps): React.JSX.Element {
  const [workspaceDir, setWorkspaceDir] = useState<string>(() => {
    return (
      payload?.workspaceDir ||
      localStorage.getItem("chat-selected-workspace") ||
      localStorage.getItem("workbench-selected-project") ||
      ""
    );
  });
  const [branch, setBranch] = useState<string | null>(null);
  const [files, setFiles] = useState<GitFileInfo[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [diffContent, setDiffContent] = useState<string>("");
  const [loading, setLoading] = useState(false);

  // 1. Load git branch & status
  useEffect(() => {
    let active = true;
    if (!workspaceDir) return;

    void desktopApi()
      .terminalGitBranches?.({ cwd: workspaceDir })
      .then((res: any) => {
        const current = res?.branch || res?.current || "HEAD";
        if (active && current) setBranch(current);
      })
      .catch(() => undefined);

    // Initial diff load for the workspace
    setLoading(true);
    void desktopApi()
      .terminalGitDiffSides?.({ cwd: workspaceDir, path: "" })
      .then((res: any) => {
        if (!active) return;
        const patch: string = res?.patch || "";
        setDiffContent(patch);
        // Parse changed files from patch headers
        const matches = Array.from(patch.matchAll(/diff --git a\/(.+?) b\/(.+?)(?=\n|$)/g));
        if (matches.length > 0) {
          const parsedFiles: GitFileInfo[] = matches.map((m: any) => ({
            path: String(m[2]),
            status: "M"
          }));
          setFiles(parsedFiles);
          setSelectedFile(parsedFiles[0]?.path || null);
        } else if (payload?.files && payload.files.length > 0) {
          const mapped: GitFileInfo[] = payload.files.map((f) => ({
            path: f.path,
            status: f.status === "added" ? "A" : f.status === "deleted" ? "D" : "M"
          }));
          setFiles(mapped);
          setSelectedFile(mapped[0]?.path || null);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [workspaceDir, payload]);

  // Load specific file diff when selected
  useEffect(() => {
    let active = true;
    if (!workspaceDir || !selectedFile) return;

    void desktopApi()
      .terminalGitDiffSides?.({ cwd: workspaceDir, path: selectedFile })
      .then((res: any) => {
        if (active && res) {
          setDiffContent(res.patch || "");
        }
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, [workspaceDir, selectedFile]);

  const handleCiteFile = useCallback((filePath: string) => {
    window.dispatchEvent(
      new CustomEvent("agent-resume:composer-append", {
        detail: {
          text: `#${filePath} 帮我分析这个改动 `
        }
      })
    );
  }, []);

  return (
    <div className="art-diff-container">
      {/* Header bar */}
      <div className="art-diff-header">
        <div className="art-diff-meta">
          <ThemeIcon name="git-branch" size={ICON_SIZE.dense} />
          <span className="art-diff-branch">{branch || "HEAD"}</span>
          <span className="art-diff-count">{files.length} 个文件变动</span>
        </div>
        {selectedFile && (
          <button
            type="button"
            className="art-note-action-btn art-note-cite-btn"
            onClick={() => handleCiteFile(selectedFile)}
            title="带入对话分析"
          >
            <ThemeIcon name="message-square-plus" size={ICON_SIZE.inline} />
            <span>带入对话分析</span>
          </button>
        )}
      </div>

      <div className="art-diff-body">
        {/* Changed Files Sidebar */}
        <div className="art-diff-file-list">
          {files.length === 0 ? (
            <div className="art-diff-empty-files">
              <ThemeIcon name="check" size={ICON_SIZE.default} />
              <span>工作区干净，无改动</span>
            </div>
          ) : (
            files.map((file) => {
              const isSelected = selectedFile === file.path;
              return (
                <div
                  key={file.path}
                  draggable
                  className={`art-diff-file-item${isSelected ? " is-active" : ""}`}
                  onClick={() => setSelectedFile(file.path)}
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/plain", `#${file.path} `);
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                  title={`拖拽或点击查看: ${file.path}`}
                >
                  <span className={`art-diff-status-tag is-${file.status}`}>{file.status}</span>
                  <span className="art-diff-file-name">{file.path}</span>
                </div>
              );
            })
          )}
        </div>

        {/* Diff Content Preview */}
        <div className="art-diff-preview-area">
          {loading ? (
            <div className="stage-artifact-empty">
              <ThemeIcon name="loader" size={ICON_SIZE.hero} className="spin" />
              <p className="stage-artifact-empty-text">正在计算 Diff...</p>
            </div>
          ) : diffContent ? (
            <pre className="art-diff-code">
              {diffContent.split("\n").map((line, idx) => {
                const isAdd = line.startsWith("+") && !line.startsWith("+++");
                const isDel = line.startsWith("-") && !line.startsWith("---");
                const isHunk = line.startsWith("@@");
                const cls = isAdd ? "line-add" : isDel ? "line-del" : isHunk ? "line-hunk" : "line-ctx";
                return (
                  <div key={idx} className={`art-diff-line ${cls}`}>
                    {line}
                  </div>
                );
              })}
            </pre>
          ) : (
            <div className="stage-artifact-empty">
              <ThemeIcon name="file-diff" size={ICON_SIZE.hero} />
              <p className="stage-artifact-empty-text">暂无选中文件的差异内容</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
