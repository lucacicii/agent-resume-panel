import { useState } from "react";
import type { PeriodComposerSendInsights, PeriodDailyTrendItem, PeriodHourlyIntensity, PeriodInsights, PeriodTagItem } from "@agent-resume/core";

export type StatusFilter = "all" | "completed" | "active" | "blocked";

type Translate = (key: string, ...args: Array<string | number>) => string;

export interface PeriodInsightsDashboardProps {
  insights: PeriodInsights | null;
  loading: boolean;
  selectedTag: string | null;
  statusFilter: StatusFilter;
  selectedProject: string | null;
  onSelectTag: (tag: string | null) => void;
  onSelectStatus: (status: StatusFilter) => void;
  onSelectProject: (projectPath: string | null) => void;
  onOpenSession: (provider: string, id: string) => void;
  onSelectDay?: (dayKey: string) => void;
  t: Translate;
}

const PROVIDER_COLORS: Record<string, string> = {
  pi: "#8b5cf6",
  claude: "#f97316",
  codex: "#10b981",
  grok: "#0ea5e9",
  chat: "#06b6d4",
  prime: "#eab308",
  opencode: "#ec4899",
  agy: "#14b8a6",
  cursor: "#6366f1",
  "cursor-ide": "#6366f1"
};

function providerColor(provider: string): string {
  return PROVIDER_COLORS[provider.toLowerCase()] || "#64748b";
}

function generateBezierPath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = i > 0 ? points[i - 1] : points[0];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = i !== points.length - 2 ? points[i + 2] : p2;

    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

export function PeriodInsightsDashboard({
  insights,
  loading,
  selectedTag,
  statusFilter,
  selectedProject,
  onSelectTag,
  onSelectStatus,
  onSelectProject,
  onOpenSession,
  onSelectDay,
  t
}: PeriodInsightsDashboardProps) {
  if (loading && !insights) {
    return (
      <div className="insights-dashboard loading">
        <div className="insights-loading-skeleton" />
      </div>
    );
  }

  if (!insights || insights.sessionStats.total === 0) {
    return null;
  }

  const { sessionStats, blockedSessions, tagStats, llmUsage, dailyTrend, composerInsights } = insights;

  // Group tags into 4 intuitive categories
  const taskTags = tagStats.byCategory.task_type || [];
  const techTags = tagStats.byCategory.tech_stack || [];
  const bizAndArchTags = [
    ...(tagStats.byCategory.business_domain || []),
    ...(tagStats.byCategory.architecture || [])
  ];
  const problemAndEnvTags = [
    ...(tagStats.byCategory.problem_domain || []),
    ...(tagStats.byCategory.context_env || []),
    ...(tagStats.byCategory.concept_knowledge || [])
  ];

  const renderTagChip = (item: PeriodTagItem) => {
    const isSelected = selectedTag === item.normalizedTag;
    return (
      <button
        key={item.normalizedTag}
        type="button"
        className={`insights-tag-chip${isSelected ? " active" : ""}`}
        onClick={() => onSelectTag(isSelected ? null : item.normalizedTag)}
        title={`${item.displayName} (${item.sessionCount} sessions)`}
      >
        <span className="insights-tag-name">{item.displayName}</span>
        <span className="insights-tag-count">{item.sessionCount}</span>
      </button>
    );
  };

  return (
    <section className="insights-dashboard" aria-label={t("desktop.report.insightsTitle")}>
      {/* 1. Row 1: All 4 charts in one row (15% : 15% : 25% : 45%) */}
      <div className="insights-row-top">
        {/* Card 1: Session Overview Donut Chart (15%) */}
        <div className="insights-card insights-sessions-card">
          <div className="insights-card-head">
            <span className="insights-card-title">{t("desktop.report.insightsSessions")}</span>
            <span className="insights-stat-total">{sessionStats.total}</span>
          </div>
          <div className="insights-donut-content">
            <SessionDonutChart
              total={sessionStats.total}
              completed={sessionStats.completed}
              active={sessionStats.active}
              blocked={sessionStats.blocked}
              other={sessionStats.other}
            />
            <div className="insights-status-pills">
              {sessionStats.completed > 0 && (
                <button
                  type="button"
                  className={`insights-status-pill completed${statusFilter === "completed" ? " active" : ""}`}
                  onClick={() => onSelectStatus(statusFilter === "completed" ? "all" : "completed")}
                  title={t("desktop.report.insightsCompleted")}
                >
                  <span className="dot" />
                  <span>{sessionStats.completed} {t("desktop.report.insightsCompleted")}</span>
                </button>
              )}
              {sessionStats.active > 0 && (
                <button
                  type="button"
                  className={`insights-status-pill active-pill${statusFilter === "active" ? " active" : ""}`}
                  onClick={() => onSelectStatus(statusFilter === "active" ? "all" : "active")}
                  title={t("desktop.report.insightsActive")}
                >
                  <span className="dot" />
                  <span>{sessionStats.active} {t("desktop.report.insightsActive")}</span>
                </button>
              )}
              {sessionStats.blocked > 0 && (
                <button
                  type="button"
                  className={`insights-status-pill blocked${statusFilter === "blocked" ? " active" : ""}`}
                  onClick={() => onSelectStatus(statusFilter === "blocked" ? "all" : "blocked")}
                  title={t("desktop.report.insightsBlocked")}
                >
                  <span className="dot" />
                  <span>{sessionStats.blocked} {t("desktop.report.insightsBlocked")}</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Card 2: Main Agent Donut Chart (15%) */}
        <div className="insights-card insights-providers-card">
          <div className="insights-card-head">
            <span className="insights-card-title">{t("desktop.report.insightsProviders")}</span>
            <span className="muted insights-subtext">
              {Object.keys(sessionStats.byProvider).length}
            </span>
          </div>
          <div className="insights-donut-content">
            <AgentDonutChart
              byProvider={sessionStats.byProvider}
              total={sessionStats.total}
            />
            <div className="insights-provider-legend-col">
              {Object.entries(sessionStats.byProvider).map(([provider, count]) => {
                const pct = sessionStats.total > 0 ? Math.round((count / sessionStats.total) * 100) : 0;
                return (
                  <div key={provider} className="insights-provider-legend-row" title={`${provider}: ${count} (${pct}%)`}>
                    <span className="dot" style={{ backgroundColor: providerColor(provider) }} />
                    <span className="provider-name">{provider}</span>
                    <span className="provider-pct">{count} ({pct}%)</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Card 3: All Projects Ranked List (25%) */}
        <div className="insights-card insights-projects-card">
          <div className="insights-card-head">
            <span className="insights-card-title">{t("desktop.report.insightsProjects")}</span>
            <span className="muted insights-subtext">
              {t("desktop.report.insightsProjectsTouched", sessionStats.byProject.length)}
            </span>
          </div>
          <div className="insights-project-bars">
            {sessionStats.byProject.map((p) => {
              const pct = sessionStats.total > 0 ? Math.round((p.count / sessionStats.total) * 100) : 0;
              const isSelected = selectedProject === p.projectPath;
              return (
                <div
                  key={p.projectPath}
                  className={`insights-project-bar-item${isSelected ? " active" : ""}`}
                  title={`${p.projectPath} (Click to filter)`}
                  onClick={() => onSelectProject(isSelected ? null : p.projectPath)}
                >
                  <div className="insights-project-meta-row">
                    <span className="insights-project-name">{p.projectName}</span>
                    <span className="insights-project-pct">
                      {p.count} ({pct}%)
                    </span>
                  </div>
                  <div className="insights-bar-track">
                    <div className="insights-bar-fill" style={{ width: `${Math.max(4, pct)}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Card 4: Model Usage & Token Throughput Dual-Line Chart (45%) */}
        <div className="insights-card insights-llm-card">
          <LlmUsageLineContent llmUsage={llmUsage} t={t} />
        </div>
      </div>

      {/* 2. User Instructions & Interaction Profile (Composer Sends - 5 Dimensions) */}
      {composerInsights && composerInsights.totalSends > 0 && (
        <ComposerSendInsightsSection
          insights={composerInsights}
          onOpenSession={onOpenSession}
          t={t}
        />
      )}

      {/* 3. Daily Activity Trend (Shown for Week & Month spans) */}
      {dailyTrend && dailyTrend.length > 1 && (
        <PeriodDailyTrendChart
          trend={dailyTrend}
          onSelectDay={onSelectDay}
          t={t}
        />
      )}

      {/* 4. Blocked Watchlist Card (shown if there are blocked sessions) */}
      {blockedSessions.length > 0 && (
        <div className="insights-blocker-section">
          <div className="insights-blocker-head">
            <strong>⚠️ {t("desktop.report.insightsBlockedList")} ({blockedSessions.length})</strong>
          </div>
          <div className="insights-blocker-list">
            {blockedSessions.map((b) => (
              <div key={`${b.provider}:${b.id}`} className="insights-blocker-item">
                <div className="insights-blocker-main">
                  <div className="insights-blocker-title-row">
                    <span className="s-provider-tag" data-provider={b.provider}>
                      {b.provider}
                    </span>
                    <strong className="insights-blocker-session-title">{b.title}</strong>
                    <span className="muted insights-blocker-proj">
                      {b.projectPath?.split(/[\\/]/).filter(Boolean).at(-1) || ""}
                    </span>
                  </div>
                  {b.blockerReason && (
                    <div className="insights-blocker-reason">
                      <span className="badge-reason">Blocker:</span> {b.blockerReason}
                    </div>
                  )}
                  {b.nextAction && (
                    <div className="insights-blocker-next">
                      <span className="badge-action">Next:</span> {b.nextAction}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  className="tool-btn ghost-btn insights-blocker-view-btn"
                  onClick={() => onOpenSession(b.provider, b.id)}
                >
                  View
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 5. Tags & Knowledge Spectrum */}
      {tagStats.totalTags > 0 && (
        <div className="insights-tags-section">
          <div className="insights-tags-head">
            <strong>🏷️ {t("desktop.report.insightsTags")}</strong>
            {selectedTag && (
              <button
                type="button"
                className="tool-btn ghost-btn insights-clear-filter-btn"
                onClick={() => onSelectTag(null)}
              >
                {t("desktop.report.insightsFilterClear")}
              </button>
            )}
          </div>
          <div className="insights-tag-categories">
            {taskTags.length > 0 && (
              <div className="insights-tag-group">
                <span className="insights-tag-group-label">
                  {t("desktop.report.insightsCategoryTaskType")}:
                </span>
                <div className="insights-tag-chips">{taskTags.map(renderTagChip)}</div>
              </div>
            )}
            {techTags.length > 0 && (
              <div className="insights-tag-group">
                <span className="insights-tag-group-label">
                  {t("desktop.report.insightsCategoryTechStack")}:
                </span>
                <div className="insights-tag-chips">{techTags.map(renderTagChip)}</div>
              </div>
            )}
            {bizAndArchTags.length > 0 && (
              <div className="insights-tag-group">
                <span className="insights-tag-group-label">
                  {t("desktop.report.insightsCategoryBusiness")}:
                </span>
                <div className="insights-tag-chips">{bizAndArchTags.map(renderTagChip)}</div>
              </div>
            )}
            {problemAndEnvTags.length > 0 && (
              <div className="insights-tag-group">
                <span className="insights-tag-group-label">
                  {t("desktop.report.insightsCategoryProblems")}:
                </span>
                <div className="insights-tag-chips">{problemAndEnvTags.map(renderTagChip)}</div>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

/** Crisp SVG Donut for Sessions */
function SessionDonutChart({
  total,
  completed,
  active,
  blocked,
  other
}: {
  total: number;
  completed: number;
  active: number;
  blocked: number;
  other: number;
}) {
  const size = 54;
  const r = 21;
  const cx = size / 2;
  const cy = size / 2;
  const strokeWidth = 6;
  const circ = 2 * Math.PI * r;

  if (total <= 0) {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="insights-donut-svg">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--border)" strokeWidth={strokeWidth} />
      </svg>
    );
  }

  let offset = 0;
  const slices = [
    { len: (completed / total) * circ, color: "#10b981", name: "completed" },
    { len: (active / total) * circ, color: "#3b82f6", name: "active" },
    { len: (blocked / total) * circ, color: "#ef4444", name: "blocked" },
    { len: (other / total) * circ, color: "#94a3b8", name: "other" }
  ].map((s) => {
    const item = { ...s, offset };
    offset += s.len;
    return item;
  });

  return (
    <div className="insights-donut-wrapper">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="insights-donut-svg">
        <g transform={`rotate(-90 ${cx} ${cy})`}>
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke="color-mix(in srgb, var(--border) 60%, transparent)"
            strokeWidth={strokeWidth}
          />
          {slices.map(
            (s) =>
              s.len > 0 && (
                <circle
                  key={s.name}
                  cx={cx}
                  cy={cy}
                  r={r}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={strokeWidth}
                  strokeDasharray={`${s.len} ${circ - s.len}`}
                  strokeDashoffset={-s.offset}
                />
              )
          )}
        </g>
        <text x={cx} y={cy + 1} textAnchor="middle" dominantBaseline="middle" className="donut-center-text">
          {total}
        </text>
      </svg>
    </div>
  );
}

/** Crisp SVG Donut for Agents */
function AgentDonutChart({
  byProvider,
  total
}: {
  byProvider: Record<string, number>;
  total: number;
}) {
  const size = 54;
  const r = 21;
  const cx = size / 2;
  const cy = size / 2;
  const strokeWidth = 6;
  const circ = 2 * Math.PI * r;

  const entries = Object.entries(byProvider);
  if (total <= 0 || entries.length === 0) {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="insights-donut-svg">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--border)" strokeWidth={strokeWidth} />
      </svg>
    );
  }

  let offset = 0;
  const slices = entries.map(([provider, count]) => {
    const len = (count / total) * circ;
    const item = { provider, len, color: providerColor(provider), offset };
    offset += len;
    return item;
  });

  return (
    <div className="insights-donut-wrapper">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="insights-donut-svg">
        <g transform={`rotate(-90 ${cx} ${cy})`}>
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke="color-mix(in srgb, var(--border) 60%, transparent)"
            strokeWidth={strokeWidth}
          />
          {slices.map(
            (s) =>
              s.len > 0 && (
                <circle
                  key={s.provider}
                  cx={cx}
                  cy={cy}
                  r={r}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={strokeWidth}
                  strokeDasharray={`${s.len} ${circ - s.len}`}
                  strokeDashoffset={-s.offset}
                />
              )
          )}
        </g>
        <text x={cx} y={cy + 1} textAnchor="middle" dominantBaseline="middle" className="donut-center-text">
          {entries.length}
        </text>
      </svg>
    </div>
  );
}

/** Dual Line Chart Content for Card 4 (45% width) */
function LlmUsageLineContent({
  llmUsage,
  t
}: {
  llmUsage: PeriodInsights["llmUsage"];
  t: Translate;
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  if (llmUsage.totalCalls <= 0) {
    return (
      <div className="insights-llm-empty">
        <div className="insights-card-head">
          <span className="insights-card-title">{t("desktop.report.insightsTokens")}</span>
        </div>
        <p className="muted" style={{ fontSize: 11, margin: "auto" }}>
          {t("desktop.report.noDigest")}
        </p>
      </div>
    );
  }

  const trend = llmUsage.trend || [];
  const width = 450;
  const height = 66;
  const padL = 24;
  const padR = 12;
  const padT = 10;
  const padB = 16;

  const innerW = width - padL - padR;
  const innerH = height - padT - padB;

  const maxTokens = Math.max(1, ...trend.map((p) => p.tokens));
  const maxCalls = Math.max(1, ...trend.map((p) => p.calls));

  const n = trend.length;
  const tokenPoints = trend.map((p, i) => {
    const x = n > 1 ? padL + (i / (n - 1)) * innerW : padL + innerW / 2;
    const y = padT + innerH - (p.tokens / maxTokens) * innerH;
    return { x, y, data: p };
  });

  const callPoints = trend.map((p, i) => {
    const x = n > 1 ? padL + (i / (n - 1)) * innerW : padL + innerW / 2;
    const y = padT + innerH - (p.calls / maxCalls) * innerH;
    return { x, y, data: p };
  });

  const tokenCurve = generateBezierPath(tokenPoints);
  const callCurve = generateBezierPath(callPoints);

  const tokenArea =
    tokenPoints.length > 1
      ? `${tokenCurve} L ${tokenPoints[tokenPoints.length - 1].x} ${padT + innerH} L ${tokenPoints[0].x} ${padT + innerH} Z`
      : "";

  const activePoint = hoverIndex !== null && hoverIndex >= 0 && hoverIndex < n ? trend[hoverIndex] : null;
  const activeTokenPt = hoverIndex !== null && hoverIndex >= 0 && hoverIndex < tokenPoints.length ? tokenPoints[hoverIndex] : null;

  return (
    <>
      <div className="insights-llm-head-row">
        <div className="insights-llm-title-group">
          <span className="insights-card-title">{t("desktop.report.insightsTokens")}</span>
          <span className="insights-llm-headline">
            {llmUsage.totalTokens >= 1000000
              ? `${(llmUsage.totalTokens / 1000000).toFixed(2)}M`
              : `${(llmUsage.totalTokens / 1000).toFixed(1)}k`}{" "}
            · {llmUsage.totalCalls} Calls
          </span>
        </div>
        <div className="insights-llm-legend-group">
          <span className="legend-item tokens-legend">
            <span className="line-sample token-sample" />
            {t("desktop.report.insightsTokensLegend")}
          </span>
          <span className="legend-item calls-legend">
            <span className="line-sample call-sample" />
            {t("desktop.report.insightsCallsLegend")}
          </span>
          {llmUsage.topModels[0] && (
            <span className="insights-top-model-pill" title={llmUsage.topModels[0].model}>
              {llmUsage.topModels[0].model.split("/").at(-1)}
            </span>
          )}
        </div>
      </div>

      <div className="insights-llm-chart-wrap" onMouseLeave={() => setHoverIndex(null)}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="insights-line-chart-svg"
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id="tokenGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#6366f1" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#6366f1" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Background horizontal guide lines */}
          <line x1={padL} y1={padT} x2={width - padR} y2={padT} stroke="color-mix(in srgb, var(--border) 40%, transparent)" strokeDasharray="3 3" />
          <line x1={padL} y1={padT + innerH / 2} x2={width - padR} y2={padT + innerH / 2} stroke="color-mix(in srgb, var(--border) 40%, transparent)" strokeDasharray="3 3" />
          <line x1={padL} y1={padT + innerH} x2={width - padR} y2={padT + innerH} stroke="var(--border)" />

          {/* Area Fill for Tokens */}
          {tokenArea && <path d={tokenArea} fill="url(#tokenGradient)" />}

          {/* Tokens Solid Curve */}
          {tokenCurve && (
            <path
              d={tokenCurve}
              fill="none"
              stroke="#6366f1"
              strokeWidth="2"
              strokeLinecap="round"
            />
          )}

          {/* Calls Dashed Curve */}
          {callCurve && (
            <path
              d={callCurve}
              fill="none"
              stroke="#f59e0b"
              strokeWidth="1.6"
              strokeDasharray="4 3"
              strokeLinecap="round"
            />
          )}

          {/* X Axis Labels */}
          {trend.map((p, i) => {
            const x = n > 1 ? padL + (i / (n - 1)) * innerW : padL + innerW / 2;
            const showLabel = n <= 8 || i === 0 || i === n - 1 || i % Math.ceil(n / 6) === 0;
            if (!showLabel) return null;
            return (
              <text
                key={i}
                x={x}
                y={height - 3}
                textAnchor="middle"
                className="insights-chart-axis-label"
              >
                {p.label}
              </text>
            );
          })}

          {/* Hover indicator */}
          {activeTokenPt && (
            <g>
              <line
                x1={activeTokenPt.x}
                y1={padT}
                x2={activeTokenPt.x}
                y2={padT + innerH}
                stroke="var(--color-accent)"
                strokeWidth="1"
                strokeDasharray="2 2"
              />
              <circle cx={activeTokenPt.x} cy={activeTokenPt.y} r="3" fill="#6366f1" stroke="#ffffff" strokeWidth="1.5" />
            </g>
          )}

          {/* Transparent hit boxes for mouse tracking */}
          {trend.map((_, i) => {
            const stepW = innerW / Math.max(1, n - 1);
            const x = padL + i * stepW - stepW / 2;
            return (
              <rect
                key={i}
                x={Math.max(0, x)}
                y={0}
                width={stepW}
                height={height}
                fill="transparent"
                style={{ cursor: "pointer" }}
                onMouseEnter={() => setHoverIndex(i)}
              />
            );
          })}
        </svg>

        {/* Floating Tooltip */}
        {activePoint && activeTokenPt && (
          <div
            className="insights-chart-tooltip"
            style={{
              left: `${Math.min(90, Math.max(10, (activeTokenPt.x / width) * 100))}%`
            }}
          >
            <div className="tooltip-label">{activePoint.label}</div>
            <div className="tooltip-val tokens-val">
              {activePoint.tokens >= 1000 ? `${(activePoint.tokens / 1000).toFixed(1)}k` : activePoint.tokens} Tokens
            </div>
            <div className="tooltip-val calls-val">{activePoint.calls} Calls</div>
          </div>
        )}
      </div>
    </>
  );
}

/** Activity Trend Chart across Days (Week & Month views) */
function PeriodDailyTrendChart({
  trend,
  onSelectDay,
  t
}: {
  trend: PeriodDailyTrendItem[];
  onSelectDay?: (dayKey: string) => void;
  t: Translate;
}) {
  const maxSessions = Math.max(1, ...trend.map((d) => d.sessionCount));
  const chartHeight = 36;

  return (
    <div className="insights-trend-section">
      <div className="insights-trend-head">
        <strong>📊 {t("desktop.report.insightsTrendTitle")}</strong>
        <span className="muted insights-trend-hint">{t("desktop.report.insightsTrendHint")}</span>
      </div>
      <div className="insights-trend-bars-container">
        {trend.map((d) => {
          const barHeight =
            d.sessionCount > 0
              ? Math.max(6, Math.round((d.sessionCount / maxSessions) * chartHeight))
              : 2;
          const isBlocked = d.blockedCount > 0;
          const hasActivity = d.sessionCount > 0;

          return (
            <div
              key={d.dayKey}
              className={`insights-trend-col${hasActivity ? " has-activity" : ""}`}
              onClick={() => onSelectDay?.(d.dayKey)}
              title={`${d.dayKey}: ${d.sessionCount} sessions (${d.completedCount} completed, ${d.blockedCount} blocked)`}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter") onSelectDay?.(d.dayKey);
              }}
            >
              <div className="insights-trend-bar-slot">
                <div
                  className={`insights-trend-bar-fill${isBlocked ? " blocked" : hasActivity ? " active" : " empty"}`}
                  style={{ height: `${barHeight}px` }}
                />
              </div>
              <span className="insights-trend-label">{d.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Composer Send Insights Section (5 Dimensions + Friction Callout) */
function ComposerSendInsightsSection({
  insights,
  onOpenSession,
  t
}: {
  insights: PeriodComposerSendInsights;
  onOpenSession: (provider: string, id: string) => void;
  t: Translate;
}) {
  const maxH = Math.max(1, ...insights.hourlyIntensity.map((x) => x.count));
  const peakItem = insights.hourlyIntensity.reduce(
    (max, item) => (item.count > max.count ? item : max),
    { hour: 0, label: "00:00", count: 0 }
  );

  return (
    <div className="insights-composer-section">
      <div className="insights-composer-head">
        <div className="insights-composer-title-group">
          <strong>💬 {t("desktop.report.composerInsightsTitle")}</strong>
          <span
            className="insights-help-icon"
            tabIndex={0}
            role="button"
            aria-label={t("desktop.report.composerHelpTitle")}
          >
            ?
            <div className="insights-help-popover" role="tooltip">
              <div className="help-title">{t("desktop.report.composerHelpTitle")}</div>
              <ul className="help-list">
                <li>
                  <strong>{t("desktop.report.composerIntentTitle")}</strong>:{" "}
                  {t("desktop.report.composerHelpIntent")}
                </li>
                <li>
                  <strong>{t("desktop.report.composerSmoothnessTitle")}</strong>:{" "}
                  {t("desktop.report.composerHelpSmooth")}
                </li>
                <li>
                  <strong>{t("desktop.report.composerHourlyTitle")}</strong>:{" "}
                  {t("desktop.report.composerHelpHourly")}
                </li>
                <li>
                  <strong>{t("desktop.report.composerTopPhrasesTitle")}</strong>:{" "}
                  {t("desktop.report.composerHelpMacros")}
                </li>
              </ul>
            </div>
          </span>
          <span className="muted insights-composer-headline">
            {t("desktop.report.composerSendsHeadline", insights.totalSends, insights.avgLength)}
          </span>
        </div>
      </div>
      <div className="insights-composer-grid">
        {/* Col 1: Intent Spectrum */}
        <div className="insights-composer-col">
          <div className="insights-subhead">{t("desktop.report.composerIntentTitle")}</div>
          <div className="insights-intent-bars">
            {renderIntentRow(t("desktop.report.composerIntentFeature"), insights.intentDistribution.feature, insights.totalSends, "#3b82f6")}
            {renderIntentRow(t("desktop.report.composerIntentQuery"), insights.intentDistribution.query, insights.totalSends, "#06b6d4")}
            {renderIntentRow(t("desktop.report.composerIntentFlow"), insights.intentDistribution.flowControl, insights.totalSends, "#10b981")}
            {renderIntentRow(t("desktop.report.composerIntentError"), insights.intentDistribution.errorDiagnosis, insights.totalSends, "#ef4444")}
            {renderIntentRow(t("desktop.report.composerIntentImage"), insights.intentDistribution.multimodal, insights.totalSends, "#8b5cf6")}
            {renderIntentRow(t("desktop.report.composerIntentConstraint"), insights.intentDistribution.constraint, insights.totalSends, "#f59e0b")}
          </div>
        </div>

        {/* Col 2: Smoothness & Turn Depth */}
        <div className="insights-composer-col">
          <div className="insights-subhead">{t("desktop.report.composerSmoothnessTitle")}</div>
          <div className="insights-smoothness-stats">
            <div className="smooth-stat-row">
              <span className="stat-bullet ok" />
              <span>{t("desktop.report.composerSmoothRate", 100 - insights.smoothness.frictionRate, insights.smoothness.smoothSends)}</span>
            </div>
            {insights.smoothness.frictionSends > 0 && (
              <div className="smooth-stat-row">
                <span className="stat-bullet warn" />
                <span>{t("desktop.report.composerFrictionRate", insights.smoothness.frictionRate, insights.smoothness.frictionSends)}</span>
              </div>
            )}
            <div className="smooth-stat-meta">
              <span className="meta-pill">
                {t(
                  "desktop.report.composerSingleTurn",
                  Math.round(
                    (insights.smoothness.singleTurnSessions /
                      Math.max(
                        1,
                        insights.smoothness.singleTurnSessions + insights.smoothness.multiTurnSessions
                      )) *
                      100
                  )
                )}
              </span>
              <span className="meta-pill">
                {t("desktop.report.composerAvgTurns", insights.smoothness.avgSendsPerSession)}
              </span>
            </div>
          </div>
        </div>

        {/* Col 3: Hourly Intensity (24h) - 维度五 */}
        <div className="insights-composer-col insights-hourly-col">
          <HourlyIntensityChart
            hourlyIntensity={insights.hourlyIntensity}
            totalSends={insights.totalSends}
            peakItem={peakItem}
            t={t}
          />
        </div>

        {/* Col 4: Frequent Macros TOP */}
        <div className="insights-composer-col">
          <div className="insights-subhead">{t("desktop.report.composerTopPhrasesTitle")}</div>
          <div className="insights-top-phrases">
            {insights.topPhrases.length > 0 ? (
              insights.topPhrases.map((p, idx) => (
                <div key={idx} className="top-phrase-row" title={p.phrase}>
                  <span className="phrase-rank">{idx + 1}.</span>
                  <span className="phrase-text">{p.phrase}</span>
                  <span className="phrase-count">×{p.count}</span>
                </div>
              ))
            ) : (
              <span className="muted" style={{ fontSize: 10 }}>None</span>
            )}
          </div>
        </div>
      </div>

      {/* Friction Sessions Callout Footer */}
      {insights.frictionSessions.length > 0 && (
        <div className="insights-friction-sessions-footer">
          <div className="friction-sessions-head">
            <span className="friction-badge">⚡</span>
            <strong>{t("desktop.report.composerFrictionSessionsTitle")}</strong>
          </div>
          <div className="friction-sessions-list">
            {insights.frictionSessions.map((fs) => (
              <div key={`${fs.provider}:${fs.id}`} className="friction-session-item">
                <div className="friction-item-main">
                  <span className="s-provider-tag" data-provider={fs.provider}>
                    {fs.provider}
                  </span>
                  <strong className="friction-session-title">{fs.title}</strong>
                  <span className="muted friction-session-proj">
                    {fs.projectPath?.split(/[\\/]/).filter(Boolean).at(-1) || ""}
                  </span>
                  <span className="friction-reasons-chips">
                    {fs.frictionReasons.map((r, i) => (
                      <span key={i} className="friction-reason-badge">
                        {r}
                      </span>
                    ))}
                  </span>
                </div>
                <button
                  type="button"
                  className="tool-btn ghost-btn friction-view-btn"
                  onClick={() => onOpenSession(fs.provider, fs.id)}
                >
                  View
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function HourlyIntensityChart({
  hourlyIntensity,
  totalSends,
  peakItem,
  t
}: {
  hourlyIntensity: PeriodHourlyIntensity[];
  totalSends: number;
  peakItem: PeriodHourlyIntensity | null;
  t: Translate;
}) {
  const [hoveredHour, setHoveredHour] = useState<PeriodHourlyIntensity | null>(null);
  const maxH = Math.max(1, ...hourlyIntensity.map((x) => x.count));

  return (
    <>
      <div className="insights-subhead-row">
        <span className="insights-subhead">{t("desktop.report.composerHourlyTitle")}</span>
        {hoveredHour ? (
          <span className="insights-hourly-hover-badge">
            {hoveredHour.label} · <strong>{hoveredHour.count}</strong> 次
          </span>
        ) : peakItem && peakItem.count > 0 ? (
          <span className="insights-hourly-peak-badge" title="Peak Hour">
            {peakItem.label} ({peakItem.count})
          </span>
        ) : null}
      </div>
      <div
        className="insights-hourly-chart-area"
        onMouseLeave={() => setHoveredHour(null)}
      >
        <div className="insights-hourly-bars-grid">
          {hourlyIntensity.map((h) => {
            const pct = maxH > 0 ? Math.round((h.count / maxH) * 100) : 0;
            const isPeak = peakItem && h.count === peakItem.count && h.count > 0;
            const isHovered = hoveredHour?.hour === h.hour;
            const countPct = totalSends > 0 ? Math.round((h.count / totalSends) * 100) : 0;

            return (
              <div
                key={h.hour}
                className={`hourly-bar-slot${h.count > 0 ? " has-data" : ""}${isPeak ? " is-peak" : ""}${isHovered ? " is-hovered" : ""}`}
                onMouseEnter={() => setHoveredHour(h)}
                title={`${h.label}: ${h.count} sends (${countPct}%)`}
              >
                {/* Floating Tooltip displaying number */}
                {isHovered && (
                  <div className="hourly-bar-tooltip">
                    <span className="tooltip-count">{h.count}</span>
                  </div>
                )}
                <div
                  className="hourly-bar-fill"
                  style={{ height: h.count > 0 ? `${Math.max(14, pct)}%` : "0%" }}
                />
              </div>
            );
          })}
        </div>
        <div className="insights-hourly-baseline" />
        <div className="insights-hourly-axis">
          <span>00:00</span>
          <span>06:00</span>
          <span>12:00</span>
          <span>18:00</span>
          <span>23:00</span>
        </div>
      </div>
    </>
  );
}

function renderIntentRow(label: string, count: number, total: number, color: string) {
  if (count <= 0) return null;
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div key={label} className="insights-intent-row">
      <div className="intent-meta">
        <span className="intent-label">{label}</span>
        <span className="intent-val">
          {count} ({pct}%)
        </span>
      </div>
      <div className="intent-track">
        <div
          className="intent-fill"
          style={{ width: `${Math.max(4, pct)}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}
