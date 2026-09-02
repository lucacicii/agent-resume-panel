import { useEffect, useMemo, useState } from "react";
import type { AgentCitation, ReportEntry } from "@agent-resume/core";
import { ThemeIcon } from "../../components/ThemeIcon";
import { Sheet } from "../../components/Sheet";
import { renderMarkdown } from "../../components/Markdown";
import { desktopApi } from "../../bridge";
import type { ImMessage, ImRoom } from "../../../shared/imTypes";
import type { Translate } from "./imUtils";

export interface CitationSheetProps {
  open: boolean;
  citations: AgentCitation[];
  initialMarker?: string | null;
  onClose: () => void;
  onOpenCitation: (citation: AgentCitation) => void;
  onResumeSession: (citation: AgentCitation) => void | Promise<void>;
  t: Translate;
}

export function isNote(citation: AgentCitation): boolean {
  return citation.source === "note" || citation.level === "note" || Boolean(citation.noteId) || Boolean(citation.relMdPath);
}

export function isSession(citation: AgentCitation): boolean {
  return citation.source === "session" || citation.level === "session" || Boolean(citation.session);
}

export function citationMarker(citation: AgentCitation): string {
  const prefix = isNote(citation) ? "N" : isSession(citation) ? "S" : "D";
  return `${prefix}${citation.index}`;
}

export function citationKey(citation: AgentCitation, index: number): string {
  return [citation.source || citation.level, citation.index, citation.reportId || citation.noteId || citation.session?.id || citation.title, index].join(":");
}

export function citationTitle(citation: AgentCitation, t: Translate): string {
  return citation.title || citation.noteId || citation.reportId || citation.session?.id || t("desktop.im.citationRef", "Citation");
}

export function periodFromCitation(citation: AgentCitation): { type: "day" | "week" | "month"; key: string } | null {
  if (!citation.reportId) return null;
  if (citation.level === "daily" && citation.reportId.startsWith("daily:")) return { type: "day", key: citation.reportId.slice(6) };
  if (citation.level === "weekly" && citation.reportId.startsWith("weekly:")) return { type: "week", key: citation.reportId.slice(7) };
  if (citation.level === "monthly" && citation.reportId.startsWith("monthly:")) return { type: "month", key: citation.reportId.slice(8) };
  return null;
}

export function citationLabel(citation: AgentCitation, t: Translate): string {
  const source = isNote(citation)
    ? t("desktop.im.citationNotes", "Note")
    : isSession(citation)
      ? t("desktop.im.citationSessions", "Session")
      : citation.level || t("desktop.im.citationReports", "Report");
  const subject =
    citation.title ||
    citation.noteId ||
    citation.reportId ||
    (citation.session ? `${citation.session.provider}/${citation.session.id.slice(0, 10)}` : "") ||
    t("desktop.im.citationRef", "Citation");
  const heading = isNote(citation) && citation.heading ? ` · ${citation.heading}` : "";
  const score = citation.score == null ? "" : ` · ${Number(citation.score).toFixed(3)}`;
  const linkedSession =
    !isSession(citation) && citation.session
      ? ` · ${citation.session.provider}/${citation.session.id.slice(0, 10)}...`
      : "";
  const marker = citationMarker(citation);
  return `[${marker}] ${source} · ${subject}${heading}${score}${linkedSession}`;
}

/**
 * Extract structured citations from an ImMessage or its associated tool executions.
 */
export function extractCitationsFromMessage(message: ImMessage, _room?: ImRoom | null): AgentCitation[] {
  // 1. If message already carries structured citations
  if (Array.isArray(message.citations) && message.citations.length > 0) {
    return message.citations;
  }

  // 2. Scan body for citation markers [N1], [S1], [D1] and synthesize citations
  const markerRegex = /\[(N|S|D)(\d+)\]/g;
  const matches = [...(message.body || "").matchAll(markerRegex)];
  if (!matches.length) return [];

  const seen = new Set<string>();
  const synthesized: AgentCitation[] = [];
  for (const match of matches) {
    const type = match[1];
    const index = Number(match[2]);
    const key = `${type}${index}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (type === "N") {
      synthesized.push({
        index,
        source: "note",
        level: "note",
        title: `Note #${index}`
      });
    } else if (type === "S") {
      synthesized.push({
        index,
        source: "session",
        level: "session",
        title: `Session #${index}`
      });
    } else if (type === "D") {
      synthesized.push({
        index,
        source: "report",
        level: "daily",
        title: `Report #${index}`
      });
    }
  }

  return synthesized;
}

export function CitationSheet({
  open,
  citations,
  initialMarker,
  onClose,
  onOpenCitation,
  onResumeSession,
  t
}: CitationSheetProps): React.JSX.Element | null {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [reportEntry, setReportEntry] = useState<Pick<ReportEntry, "title" | "content"> | null>(null);
  const [reportError, setReportError] = useState("");

  const citationItems = useMemo(
    () => citations.map((citation, index) => ({ citation, key: citationKey(citation, index) })),
    [citations]
  );

  useEffect(() => {
    if (!open) {
      setSelectedKey(null);
      setReportEntry(null);
      setReportError("");
      return;
    }
    if (initialMarker) {
      const match = citationItems.find(({ citation }) => citationMarker(citation) === initialMarker);
      if (match) {
        setSelectedKey(match.key);
        return;
      }
    }
    if (citationItems.length > 0 && !selectedKey) {
      setSelectedKey(citationItems[0]?.key || null);
    }
  }, [open, initialMarker, citationItems]);

  const selected = useMemo(
    () => (selectedKey === null ? null : citationItems.find((item) => item.key === selectedKey) || null),
    [citationItems, selectedKey]
  );

  useEffect(() => {
    if (!selected?.citation.reportId || isNote(selected.citation) || isSession(selected.citation)) {
      setReportEntry(null);
      setReportError("");
      return;
    }
    let active = true;
    setReportEntry(null);
    setReportError("");
    const api = window.agentResume;
    if (api && typeof api.getReportEntry === "function") {
      void api.getReportEntry(selected.citation.reportId).then((entry) => {
        if (active) setReportEntry(entry);
      }).catch((error) => {
        if (active) setReportError(error instanceof Error ? error.message : String(error));
      });
    }
    return () => { active = false; };
  }, [selected?.citation.reportId, selected?.key]);

  const groups = useMemo(() => {
    return [
      { id: "report", title: t("desktop.im.citationReports", "Report citations"), citations: citationItems.filter(({ citation }) => !isNote(citation) && !isSession(citation)) },
      { id: "note", title: t("desktop.im.citationNotes", "Note citations"), citations: citationItems.filter(({ citation }) => isNote(citation)) },
      { id: "session", title: t("desktop.im.citationSessions", "Session citations"), citations: citationItems.filter(({ citation }) => isSession(citation)) }
    ].filter((group) => group.citations.length > 0);
  }, [citationItems, t]);

  const sourceTitle = selected
    ? (isNote(selected.citation)
        ? t("desktop.im.citationNotes", "Note")
        : isSession(selected.citation)
          ? t("desktop.im.citationSessions", "Session")
          : t("desktop.im.citationReports", "Report"))
    : "";

  const openLabel = selected && (isNote(selected.citation)
    ? t("desktop.im.openInNotes", "Open in Notes")
    : isSession(selected.citation)
      ? t("desktop.im.openInSessions", "Preview Session")
      : t("desktop.im.openInReport", "Focus in Report"));

  const details = selected ? [
    [t("desktop.im.citationField.source", "Source"), sourceTitle],
    [t("desktop.im.citationField.level", "Level"), selected.citation.level],
    [t("desktop.im.citationField.operation", "Operation"), selected.citation.operation || ""],
    [t("desktop.im.citationField.score", "Score"), selected.citation.score == null ? "" : String(selected.citation.score)],
    [t("desktop.im.citationField.reportId", "Report ID"), selected.citation.reportId || ""],
    [t("desktop.im.citationField.noteId", "Note ID"), selected.citation.noteId || ""],
    [t("desktop.im.citationField.path", "Path"), selected.citation.relMdPath || ""],
    [t("desktop.im.citationField.scope", "Scope"), selected.citation.scope || ""],
    [t("desktop.im.citationField.heading", "Heading"), selected.citation.heading || ""],
    [t("desktop.im.citationField.period", "Period"), selected.citation.periodStartMs ? new Date(selected.citation.periodStartMs).toLocaleString() : ""],
    [t("desktop.im.citationField.session", "Session"), selected.citation.session ? `${selected.citation.session.provider}:${selected.citation.session.id}${selected.citation.session.projectPath ? ` · ${selected.citation.session.projectPath}` : ""}` : ""]
  ].filter(([, value]) => Boolean(value)) : [];

  const content = reportEntry?.content || selected?.citation.contentPreview || (selected?.citation.session
    ? `**${selected.citation.session.provider}** \`${selected.citation.session.id}\`${selected.citation.session.projectPath ? `\n\n${selected.citation.session.projectPath}` : ""}`
    : "");

  return (
    <Sheet
      open={open}
      title={t("desktop.im.citationsTitle", "Citations")}
      onClose={onClose}
      bodyClassName="citation-sheet"
    >
      <p className="muted citation-sheet-description">
        {t("desktop.im.citationsDescription", "Sources cited in this response from memory digests, notes, and historical sessions.")}
      </p>
      {groups.length ? (
        <div className="citation-sheet-groups">
          {groups.map((group) => (
            <section className="citation-sheet-group" key={group.id}>
              <h4>{group.title} ({group.citations.length})</h4>
              {group.citations.map(({ citation, key }) => {
                const expanded = selected?.key === key;
                return (
                  <article className={`citation-sheet-item${expanded ? " is-expanded" : ""}`} key={key}>
                    <button
                      type="button"
                      className="citation-sheet-item-head"
                      aria-expanded={expanded}
                      onClick={() => setSelectedKey(expanded ? null : key)}
                    >
                      <ThemeIcon name="chevron-down" size={15} />
                      <span>{citationLabel(citation, t)}</span>
                    </button>
                    {expanded ? (
                      <div className="citation-sheet-item-body">
                        <h5>{citationTitle(citation, t)}</h5>
                        <dl className="citation-sheet-fields">
                          {details.map(([label, value]) => (
                            <div key={label}>
                              <dt>{label}</dt>
                              <dd>{value}</dd>
                            </div>
                          ))}
                        </dl>
                        {reportError ? <p className="tool-trace-error">{reportError}</p> : null}
                        {content ? (
                          <section className="citation-sheet-content">
                            <h5>{t("desktop.im.citationContent", "Content preview")}</h5>
                            <div className="markdown-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }} />
                          </section>
                        ) : (
                          <p className="muted">{t("desktop.im.citationNoPreview", "No preview content available")}</p>
                        )}
                        <div className="citation-sheet-actions">
                          <button type="button" className="ghost-btn" onClick={() => onOpenCitation(citation)}>
                            {openLabel}
                          </button>
                          {isSession(citation) && citation.session ? (
                            <button type="button" className="ghost-btn" onClick={() => void onResumeSession(citation)}>
                              {t("desktop.im.resumeSession", "Resume in Workbench")}
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </section>
          ))}
        </div>
      ) : (
        <p className="muted tool-trace-empty">{t("desktop.im.citationsEmpty", "No citation records found")}</p>
      )}
    </Sheet>
  );
}
