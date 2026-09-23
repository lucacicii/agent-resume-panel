import React from "react";
import { ICON_SIZE, ThemeIcon, type ThemeIconName } from "../../components/ThemeIcon";

interface QuickStarter {
  title: string;
  description: string;
  icon: ThemeIconName;
  prompt: string;
}

const STARTERS: QuickStarter[] = [
  {
    title: "Inspect Git Status & Changes",
    description: "Review current git diff, uncommitted changes and branch status.",
    icon: "git-branch",
    prompt: "请帮我检查当前工作区的 git status 和最近的未提交变更，并给出简洁总结。"
  },
  {
    title: "Explore Project Architecture",
    description: "Scan folder structure, key crates/packages, and entrypoints.",
    icon: "folder",
    prompt: "请阅读当前工作区的文件目录和关键配置，分析并总结该项目的整体架构与核心技术栈。"
  },
  {
    title: "Run Tests & Diagnostics",
    description: "Execute test suite and detect any failing test cases.",
    icon: "terminal",
    prompt: "请在当前工作区运行测试命令（或单元测试脚本），排查是否有报错并协助定位问题。"
  },
  {
    title: "Draft Implementation Plan",
    description: "Brainstorm and plan step-by-step code implementation.",
    icon: "sparkles",
    prompt: "我想为当前项目新增一个核心功能，请根据已有代码约定，为我规划详细的分步实现方案。"
  }
];

interface ChatEmptyStateProps {
  onSelectPrompt: (prompt: string) => void;
  daemonOnline?: boolean;
}

export function ChatEmptyState({ onSelectPrompt, daemonOnline = true }: ChatEmptyStateProps) {
  return (
    <div className="tb-empty-state-container">
      <div className="tb-empty-state-hero">
        <div className="tb-empty-state-badge">
          <ThemeIcon name="sparkles" size={ICON_SIZE.default} />
        </div>
        <h2 className="tb-empty-state-title">Thunder Agent</h2>
        <p className="tb-empty-state-subtitle">
          Next-generation coding agent loop with tool-use, reasoning traces, and MCP skills.
        </p>
        {!daemonOnline && (
          <div className="tb-empty-daemon-warning">
            <span className="tb-status-dot offline" />
            <span>Thunder daemon is initializing or offline. Running tasks will use local fallback.</span>
          </div>
        )}
      </div>

      <div className="tb-empty-state-grid">
        {STARTERS.map((starter) => (
          <button
            key={starter.title}
            type="button"
            className="tb-starter-card"
            onClick={() => onSelectPrompt(starter.prompt)}
          >
            <div className="tb-starter-icon">
              <ThemeIcon name={starter.icon} size={ICON_SIZE.dense} />
            </div>
            <div className="tb-starter-text">
              <div className="tb-starter-title">{starter.title}</div>
              <div className="tb-starter-desc">{starter.description}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
