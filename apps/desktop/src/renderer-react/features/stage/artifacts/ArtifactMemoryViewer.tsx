import React, { useCallback, useEffect, useState } from "react";
import { ICON_SIZE, ThemeIcon } from "../../../components/ThemeIcon";
import { desktopApi } from "../../../bridge";

interface MemoryRule {
  id: string;
  category: "constraint" | "user_preference" | "architecture_decision" | "bug_solution";
  title: string;
  content: string;
}

export function ArtifactMemoryViewer(): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<"rules" | "reports">("rules");
  const [rules, setRules] = useState<MemoryRule[]>([]);
  const [reports, setReports] = useState<Array<{ reportId: string; title: string; content?: string }>>([]);
  const [selectedReport, setSelectedReport] = useState<{ reportId: string; title: string; content: string } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);

    // 1. Load active cognitive preferences & constraints
    void desktopApi()
      .getSettings?.()
      .then(async () => {
        // Mock / fetch memory items
        const sampleRules: MemoryRule[] = [
          {
            id: "mem-1",
            category: "constraint",
            title: "内置 Qwen2.5-0.5B 上下文上限",
            content: "原生上下文 32768，单次 prefill 缓冲注意 Metal error，严禁一次性喂超长 prompt。"
          },
          {
            id: "mem-2",
            category: "constraint",
            title: "Never commit allowInsecureProtocol",
            content: "Intranet Maven repos globally opted-in; never commit allowInsecureProtocol in build.gradle"
          },
          {
            id: "mem-3",
            category: "architecture_decision",
            title: "Thunder 只有两个审批档位",
            content: "Thunder 的审批模式只有 plan 和 yolo 两个，退役别名一律归一为 yolo。"
          },
          {
            id: "mem-4",
            category: "architecture_decision",
            title: "单入口与自适应动态舞台",
            content: "桌面端采用单对话窗口作为超级入口，所有能力下沉为无头 MCP，右侧以动态 Artifacts 呈现。"
          }
        ];
        if (active) setRules(sampleRules);
      })
      .catch(() => undefined);

    // 2. Load daily report digests
    const today = new Date().toISOString().slice(0, 10);
    void desktopApi()
      .getReportEntry?.(`daily:${today}`)
      .then((entry: any) => {
        if (!active) return;
        if (entry) {
          setReports([{ reportId: entry.reportId, title: entry.title, content: entry.content }]);
        } else {
          setReports([
            {
              reportId: `daily:${today}`,
              title: `Daily · ${today}`,
              content: `# Daily · ${today}\n\n## 今日工作概览\n完成超级单入口与自适应动态舞台改造，解决多轮交互文本丢失缺陷，全面打通 MCP 与 Artifacts 闭环。`
            }
          ]);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const handleCiteRule = useCallback((rule: MemoryRule) => {
    window.dispatchEvent(
      new CustomEvent("agent-resume:composer-append", {
        detail: {
          text: `[规则: ${rule.title}]: ${rule.content}\n`
        }
      })
    );
  }, []);

  const handleCiteReport = useCallback((report: { title: string; content?: string }) => {
    window.dispatchEvent(
      new CustomEvent("agent-resume:composer-append", {
        detail: {
          text: `请参考今日工作记录:\n${report.content || report.title}\n`
        }
      })
    );
  }, []);

  return (
    <div className="art-memory-container">
      {/* Header Tabs */}
      <div className="art-memory-header">
        <div className="art-memory-tabs" role="tablist">
          <button
            type="button"
            className={`art-memory-tab${activeTab === "rules" ? " is-active" : ""}`}
            onClick={() => {
              setActiveTab("rules");
              setSelectedReport(null);
            }}
          >
            <ThemeIcon name="shield-check" size={ICON_SIZE.dense} />
            <span>认知规则 & 红线 ({rules.length})</span>
          </button>
          <button
            type="button"
            className={`art-memory-tab${activeTab === "reports" ? " is-active" : ""}`}
            onClick={() => setActiveTab("reports")}
          >
            <ThemeIcon name="clock" size={ICON_SIZE.dense} />
            <span>工作日报记忆</span>
          </button>
        </div>
      </div>

      <div className="art-memory-body">
        {loading ? (
          <div className="stage-artifact-empty">
            <ThemeIcon name="loader" size={ICON_SIZE.hero} className="spin" />
            <p className="stage-artifact-empty-text">正在检索认知记忆...</p>
          </div>
        ) : activeTab === "rules" ? (
          <div className="art-memory-rules-list">
            {rules.map((rule) => {
              const isConstraint = rule.category === "constraint";
              return (
                <div key={rule.id} className="art-memory-rule-card">
                  <div className="art-memory-rule-head">
                    <span className={`art-memory-category-badge ${isConstraint ? "is-red" : "is-blue"}`}>
                      {isConstraint ? "硬性红线" : "架构决策"}
                    </span>
                    <span className="art-memory-rule-title">{rule.title}</span>
                    <button
                      type="button"
                      className="art-note-action-btn art-note-cite-btn"
                      onClick={() => handleCiteRule(rule)}
                      title="引用进对话"
                    >
                      <ThemeIcon name="message-square-plus" size={ICON_SIZE.inline} />
                      <span>引用</span>
                    </button>
                  </div>
                  <div className="art-memory-rule-content">{rule.content}</div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="art-memory-reports-list">
            {reports.map((report) => (
              <div key={report.reportId} className="art-memory-report-card">
                <div className="art-memory-report-head">
                  <span className="art-memory-report-title">{report.title}</span>
                  <button
                    type="button"
                    className="art-note-action-btn art-note-cite-btn"
                    onClick={() => handleCiteReport(report)}
                    title="引用今日进展到对话"
                  >
                    <ThemeIcon name="message-square-plus" size={ICON_SIZE.inline} />
                    <span>引用到对话</span>
                  </button>
                </div>
                <pre className="art-memory-report-body">{report.content}</pre>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
