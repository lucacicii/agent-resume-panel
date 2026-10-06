import React, { useState } from "react";
import { ICON_SIZE, ThemeIcon } from "../../components/ThemeIcon";
import type { ThunderFileChangeRecord } from "@agent-resume/core";

export interface FileFootprintListProps {
  files: ThunderFileChangeRecord[];
  workspaceDir?: string;
}

/**
 * Read-only event footprint: what the agent says it touched this conversation,
 * including failed writes and files outside git. Extracted from the old Files
 * popover so it can live as the Footprint tab of the Changes panel.
 */
export function FileFootprintList({ files, workspaceDir }: FileFootprintListProps): React.JSX.Element {
  const [copiedPath, setCopiedPath] = useState<string | null>(null);

  const handleCopy = (pathStr: string) => {
    navigator.clipboard.writeText(pathStr).catch(() => {});
    setCopiedPath(pathStr);
    setTimeout(() => setCopiedPath(null), 2000);
  };

  // Format path relative to workspace if within workspace
  const formatPath = (p: string) => {
    if (workspaceDir && p.startsWith(workspaceDir)) {
      const rel = p.slice(workspaceDir.length);
      return rel.startsWith("/") ? rel.slice(1) : rel;
    }
    return p;
  };

  return (
    <div className="tb-footprint-body">
      {files.length === 0 ? (
        <div className="tb-trace-empty">
          <ThemeIcon name="file" size={ICON_SIZE.prominent} />
          <p>No file modifications recorded in this conversation.</p>
          <span>Files written via write_file or modified by bash will appear here.</span>
        </div>
      ) : (
        <div className="tb-files-list">
          {files.map((file, idx) => {
            const isCopied = copiedPath === file.path;
            const displayPath = formatPath(file.path);

            return (
              <div
                key={`file_${idx}_${file.path}`}
                className={`tb-file-item tb-file-action-${file.action}`}
              >
                <div className="tb-file-item-left">
                  <span className={`tb-file-badge tb-file-badge-${file.action}`}>
                    {file.action}
                  </span>
                  <span className="tb-file-tool-tag">{file.tool}</span>
                  <span className="tb-file-path" title={file.path}>
                    {displayPath}
                  </span>
                </div>

                <div className="tb-file-item-right">
                  {file.bytes !== undefined && (
                    <span className="tb-file-bytes">{file.bytes} B</span>
                  )}
                  <button
                    type="button"
                    className="tb-file-copy-btn"
                    onClick={() => handleCopy(file.path)}
                    title="Copy absolute path"
                  >
                    <ThemeIcon
                      name={isCopied ? "check" : "copy"}
                      size={ICON_SIZE.inline}
                    />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="tb-files-footer">
        <ThemeIcon name="shield-check" size={ICON_SIZE.inline} />
        <span>
          Atomic write transactions (write_file) and git-tracked bash changes are monitored.
        </span>
      </div>
    </div>
  );
}
