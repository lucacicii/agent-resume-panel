import { memo, useMemo, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import { ThemeIcon } from "../../components/ThemeIcon";
import { renderMarkdown } from "../../components/Markdown";
import { desktopApi } from "../../bridge";
import type { ImJob, ImMember, ImMessage, ImRoom } from "../../../shared/imTypes";
import {
  agentTag,
  dayKey,
  formatDay,
  formatTime,
  isActiveJobStatus,
  isResumableJob,
  isScratchPath,
  parseDispatchBlocks,
  roleColor,
  roleInitial,
  roleLabel,
  type Translate
} from "./imUtils";

export interface ImMessageItemProps {
  message: ImMessage;
  prevMessage?: ImMessage;
  allMembers: ImMember[];
  room?: ImRoom | null;
  displayBody: string;
  isTranslating: boolean;
  translated: boolean;
  isFlashing: boolean;
  isThinkingExpanded: boolean;
  isFilesExpanded: boolean;
  copiedFilePath: string | null;
  memberLabel: (member: ImMember) => string;
  onToggleThinking: (messageId: string) => void;
  onToggleFiles: (messageId: string) => void;
  onCopyText: (text: string) => void;
  onQuoteMessage: (message: ImMessage) => void;
  onTranslateMessage: (message: ImMessage) => void;
  onContinueAsk: (message: ImMessage) => void;
  onResumeJob: (job: ImJob) => void;
  onCancelJob?: (job: ImJob) => void;
  onPreviewImage: (url: string) => void;
  onCopyFilePath: (pathStr: string) => void;
  onEditDelegation: (instruction: string, targetMember?: ImMember) => void;
  onOpenSelectionMenu: (event: ReactMouseEvent<HTMLElement>, message: ImMessage) => void;
  onRoutingTipClick: () => void;
  t: Translate;
}

export const ImMessageItem = memo(function ImMessageItem({
  message,
  prevMessage,
  allMembers,
  room,
  displayBody,
  isTranslating,
  translated,
  isFlashing,
  isThinkingExpanded,
  isFilesExpanded,
  copiedFilePath,
  memberLabel,
  onToggleThinking,
  onToggleFiles,
  onCopyText,
  onQuoteMessage,
  onTranslateMessage,
  onContinueAsk,
  onResumeJob,
  onCancelJob,
  onPreviewImage,
  onCopyFilePath,
  onEditDelegation,
  onOpenSelectionMenu,
  onRoutingTipClick,
  t
}: ImMessageItemProps) {
  const speaker = useMemo(() => {
    return allMembers.find((member) => member.memberId === message.authorMemberId)
      || allMembers.find((member) => member.templateId === message.authorMemberId)
      || allMembers.find((member) => member.name === message.authorLabel || roleLabel(member, t) === message.authorLabel);
  }, [allMembers, message.authorLabel, message.authorMemberId, t]);

  const roleColorValue = speaker ? roleColor(speaker.templateId) : (message.kind === "role.say" ? roleColor(message.authorLabel) : undefined);
  const showDate = !prevMessage || dayKey(prevMessage.createdAtMs) !== dayKey(message.createdAtMs);
  const showThreadBreak = Boolean(
    message.threadId &&
    prevMessage?.threadId &&
    prevMessage.threadId !== message.threadId
  );

  const linkedJob = message.jobId ? room?.jobs.find((j) => j.jobId === message.jobId) : undefined;
  const activeJobForSpeaker = (message.kind === "role.say" && speaker)
    ? room?.jobs.find((j) => j.memberId === speaker.memberId && isActiveJobStatus(j.status))
    : undefined;
  const currentActiveJob = (linkedJob && isActiveJobStatus(linkedJob.status)) ? linkedJob : activeJobForSpeaker;
  const isAnswering = Boolean(message.kind === "role.say" && (message.streaming || currentActiveJob));
  const cancelTargetJob = currentActiveJob ?? (message.jobId ? ({ jobId: message.jobId } as ImJob) : undefined);
  const filesChanged = linkedJob?.filesChanged ?? [];

  const dispatchBlocks = useMemo(() => {
    return message.kind === "role.say" ? parseDispatchBlocks(displayBody) : [];
  }, [displayBody, message.kind]);

  const cleanBody = useMemo(() => {
    return dispatchBlocks.length > 0
      ? displayBody.replace(/<im_dispatch[\s\S]*?<\/im_dispatch>/gi, "").trim()
      : displayBody;
  }, [dispatchBlocks.length, displayBody]);

  const renderedThinking = useMemo(() => {
    return message.thinking && isThinkingExpanded ? renderMarkdown(message.thinking) : "";
  }, [isThinkingExpanded, message.thinking]);

  const renderedCleanBody = useMemo(() => {
    if (!cleanBody) return "";
    const html = renderMarkdown(cleanBody);
    return html.replace(
      /\[(N|S|D)(\d+)\]/g,
      '<a class="agent-citation-link" data-agent-citation="$1$2" href="#citation-$1$2">[$1$2]</a>'
    );
  }, [cleanBody]);

  const handleBodyClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    const target = (event.target as HTMLElement).closest<HTMLAnchorElement>("a[data-agent-citation]");
    if (!target) return;
    event.preventDefault();
    const marker = target.dataset.agentCitation || "";
    const prefix = marker.charAt(0);
    if (prefix === "N") {
      window.dispatchEvent(new CustomEvent("agent-resume:tab-request", { detail: "notes" }));
    } else if (prefix === "S") {
      window.dispatchEvent(new CustomEvent("agent-resume:tab-request", { detail: "workbench" }));
    } else if (prefix === "D") {
      window.dispatchEvent(new CustomEvent("agent-resume:tab-request", { detail: "report" }));
    }
  };

  const proposals = useMemo(() => {
    if (message.delegationProposals && message.delegationProposals.length > 0) {
      return message.delegationProposals;
    }
    if (dispatchBlocks.length > 0) {
      return dispatchBlocks.map((b, idx) => ({
        id: `fallback-${idx}`,
        targetTemplateId: b.target,
        targetRoleName: b.target,
        instruction: b.instruction,
        reason: b.reason,
        status: "pending" as const,
        dispatchedMessageId: undefined,
        dispatchedJobId: undefined,
        resolvedAtMs: undefined,
        createdAtMs: message.createdAtMs
      }));
    }
    return [];
  }, [dispatchBlocks, message.createdAtMs, message.delegationProposals]);

  return (
    <>
      {showDate && (
        <div className="im-date-separator" aria-hidden="true">{formatDay(message.createdAtMs, t)}</div>
      )}
      {showThreadBreak && (
        <div className="im-thread-separator" role="separator">{t("desktop.im.newConversation")}</div>
      )}
      <article
        id={`im-msg-${message.messageId}`}
        className={`im-message is-${message.kind.replace(".", "-")}${isFlashing ? " is-flashing" : ""}`}
        style={roleColorValue ? { "--im-role-color": roleColorValue } as CSSProperties : undefined}
        onContextMenu={(event) => onOpenSelectionMenu(event, message)}
      >
        {message.kind !== "system" && (
          <header>
            <span className="im-message-author">
              {roleColorValue && (
                <span className="im-role-avatar" aria-hidden="true" style={{ "--im-role-color": roleColorValue } as CSSProperties}>
                  {roleInitial(speaker ? memberLabel(speaker) : message.authorLabel)}
                </span>
              )}
              <strong>
                {speaker ? memberLabel(speaker) : message.authorLabel}
                {speaker ? <> {agentTag(speaker.agent, speaker.model, t)}</> : null}
              </strong>
              {message.autoRouted && message.routedRoleName && (
                <span className="im-auto-routed-badge" title={t("desktop.im.autoRoutedTo", message.routedRoleName)}>
                  <ThemeIcon name="sparkles" size={11} aria-hidden="true" />
                  <span>{t("desktop.im.autoRoutedTo", message.routedRoleName)}</span>
                </span>
              )}
            </span>
            <span className="im-message-meta">
              <time dateTime={new Date(message.createdAtMs).toISOString()} className="im-message-time">
                {formatTime(message.createdAtMs)}
              </time>
            </span>
          </header>
        )}
        {message.quotes.length > 0 && (
          <div className="im-quote-list">
            {message.quotes.map((quote) => (
              <blockquote key={quote.messageId}>
                <span>{quote.authorLabel}</span>
                {quote.body}
              </blockquote>
            ))}
          </div>
        )}
        {message.mentionRoleIds.length > 0 && (
          <div className="im-message-mentions" aria-label={t("desktop.im.mentions")}>
            {message.mentionRoleIds.map((mentionId) => {
              const mentionMember = room?.members.find((item) => item.memberId === mentionId);
              const mentionColor = mentionMember ? roleColor(mentionMember.templateId) : undefined;
              return (
                <span
                  key={mentionId}
                  className="im-message-mention"
                  style={mentionColor ? { "--im-role-color": mentionColor } as CSSProperties : undefined}
                >
                  @{mentionMember ? memberLabel(mentionMember) : mentionId}
                </span>
              );
            })}
          </div>
        )}
        {message.thinking ? (
          <div className="im-message-thinking">
            <button
              type="button"
              className="im-message-thinking-toggle"
              aria-expanded={isThinkingExpanded}
              onClick={() => onToggleThinking(message.messageId)}
            >
              <ThemeIcon
                name="chevron-right"
                className={isThinkingExpanded ? "is-expanded" : ""}
                size={12}
                aria-hidden="true"
              />
              <span>
                {t("desktop.im.thinking")}
                {message.streaming && !message.body ? (
                  <span className="im-thinking-spinner" aria-hidden="true" />
                ) : null}
              </span>
            </button>
            {isThinkingExpanded && renderedThinking ? (
              <div
                className="im-message-thinking-body markdown-body"
                dangerouslySetInnerHTML={{ __html: renderedThinking }}
              />
            ) : null}
          </div>
        ) : null}
        {message.images && message.images.length > 0 && (
          <div className="im-message-images">
            {message.images.map((img) => (
              <button
                key={img.id}
                type="button"
                className="im-message-image-card"
                onClick={() => onPreviewImage(img.previewUrl || "")}
                title={img.fileName}
              >
                <img src={img.previewUrl || ""} alt={img.fileName} loading="lazy" />
                <span className="im-message-image-name">{img.fileName}</span>
              </button>
            ))}
          </div>
        )}
        {renderedCleanBody ? (
          <div
            className="markdown-body"
            dangerouslySetInnerHTML={{ __html: renderedCleanBody }}
            onClick={handleBodyClick}
          />
        ) : null}
        {proposals.length > 0 && (
          <div className="im-message-dispatches">
            {proposals.map((proposal) => {
              const targetMember = allMembers.find((m) =>
                m.templateId === proposal.targetTemplateId ||
                m.memberId === proposal.targetTemplateId ||
                m.name.toLowerCase() === (proposal.targetRoleName || proposal.targetTemplateId).toLowerCase() ||
                m.templateId.toLowerCase() === proposal.targetTemplateId.toLowerCase()
              );
              const targetLabel = targetMember ? memberLabel(targetMember) : (proposal.targetRoleName || proposal.targetTemplateId);
              const targetColor = targetMember ? roleColor(targetMember.templateId) : roleColor(proposal.targetTemplateId);
              const isPending = proposal.status === "pending";
              const dispatchedJob = "dispatchedJobId" in proposal && proposal.dispatchedJobId
                ? room?.jobs.find((item) => item.jobId === proposal.dispatchedJobId)
                : undefined;
              const canResumeDispatch = isResumableJob(dispatchedJob, room?.jobs ?? []);
              return (
                <div key={proposal.id} className="im-dispatch-card" style={{ "--im-role-color": targetColor } as CSSProperties}>
                  <div className="im-dispatch-header">
                    <span className="im-role-avatar" aria-hidden="true" style={{ "--im-role-color": targetColor } as CSSProperties}>
                      {roleInitial(targetLabel)}
                    </span>
                    <strong>{t("desktop.im.delegationProposal", targetLabel)}</strong>
                    <span className={`im-dispatch-status is-${proposal.status.replace("_", "-")}`}>
                      {t(`desktop.im.delegationStatus.${proposal.status}`)}
                    </span>
                    {proposal.reason ? <span className="im-dispatch-reason">{proposal.reason}</span> : null}
                  </div>
                  <div className="im-dispatch-instruction">
                    {proposal.instruction}
                  </div>
                  <div className="im-dispatch-actions">
                    {isPending && room ? (
                      <>
                        <button
                          type="button"
                          className="btn small primary"
                          onClick={() => void desktopApi().imDispatchProposal({
                            projectId: room.project.projectId,
                            messageId: message.messageId,
                            proposalId: proposal.id
                          })}
                        >
                          <ThemeIcon name="send" size={12} aria-hidden="true" />
                          <span>{t("desktop.im.delegationApprove")}</span>
                        </button>
                        <button
                          type="button"
                          className="ghost-btn small"
                          onClick={() => onEditDelegation(proposal.instruction, targetMember)}
                        >
                          <ThemeIcon name="pencil" size={12} aria-hidden="true" />
                          <span>{t("desktop.im.delegationEdit")}</span>
                        </button>
                        <button
                          type="button"
                          className="ghost-btn small"
                          onClick={() => void desktopApi().imDismissProposal({
                            projectId: room.project.projectId,
                            messageId: message.messageId,
                            proposalId: proposal.id
                          })}
                        >
                          <ThemeIcon name="close" size={12} aria-hidden="true" />
                          <span>{t("desktop.im.delegationDismiss")}</span>
                        </button>
                      </>
                    ) : (
                      <>
                        {canResumeDispatch && dispatchedJob ? (
                          <button
                            type="button"
                            className="btn small primary"
                            onClick={() => void onResumeJob(dispatchedJob)}
                          >
                            <ThemeIcon name="refresh" size={12} aria-hidden="true" />
                            <span>{t("desktop.im.resumeJob")}</span>
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="ghost-btn small"
                          onClick={() => onEditDelegation(proposal.instruction, targetMember)}
                        >
                          <ThemeIcon name="pencil" size={12} aria-hidden="true" />
                          <span>{t("desktop.im.delegationEdit")}</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {filesChanged.length > 0 && (
          <div className="im-message-files">
            <button
              type="button"
              className="im-message-files-toggle"
              aria-expanded={isFilesExpanded}
              onClick={() => onToggleFiles(message.messageId)}
            >
              <ThemeIcon
                name="chevron-right"
                className={isFilesExpanded ? "is-expanded" : ""}
                size={12}
                aria-hidden="true"
              />
              <ThemeIcon name="file-text" size={13} aria-hidden="true" />
              <span>
                {filesChanged.length === 1
                  ? t("desktop.im.fileModifiedSingle")
                  : t("desktop.im.filesModified", filesChanged.length)}
              </span>
            </button>
            {isFilesExpanded ? (
              <div className="im-message-files-list">
                {filesChanged.map((filePath) => {
                  const absPath = room?.project.localPath && !filePath.startsWith("/")
                    ? `${room.project.localPath.replace(/\/+$/, "")}/${filePath}`
                    : filePath;
                  const displayPath = room?.project.localPath && filePath.startsWith(room.project.localPath)
                    ? filePath.slice(room.project.localPath.length).replace(/^\/+/, "")
                    : filePath;
                  return (
                    <div key={filePath} className="im-message-file-item" title={absPath}>
                      <ThemeIcon name="file-text" size={12} aria-hidden="true" />
                      <span className="im-message-file-path">{displayPath}</span>
                      <div className="im-message-file-actions">
                        <button
                          type="button"
                          className="im-message-file-btn"
                          onClick={() => void onCopyFilePath(absPath)}
                          title={copiedFilePath === absPath ? t("desktop.im.copiedPath") : t("desktop.im.copyPath")}
                          aria-label={t("desktop.im.copyPath")}
                        >
                          <ThemeIcon name={copiedFilePath === absPath ? "check" : "copy"} size={11} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="im-message-file-btn"
                          disabled={!room?.project.localPath}
                          onClick={() => {
                            const rootPath = room?.project.localPath;
                            if (!rootPath) return;
                            void desktopApi().workbenchRevealPath({ rootPath, targetPath: absPath });
                          }}
                          title={t("desktop.common.revealInFinder")}
                          aria-label={t("desktop.common.revealInFinder")}
                        >
                          <ThemeIcon name="external-link" size={11} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="im-message-file-btn"
                          disabled={!room?.project.localPath || isScratchPath(room.project.localPath)}
                          onClick={() => {
                            const projectPath = room?.project.localPath;
                            if (!projectPath || isScratchPath(projectPath)) return;
                            window.dispatchEvent(new CustomEvent("agent-resume:tab-request", { detail: "workbench" }));
                            window.dispatchEvent(new CustomEvent("agent-resume:workbench-open-diff", {
                              detail: { projectPath, filePath: absPath }
                            }));
                          }}
                          title={t("desktop.im.revealInWorkbench")}
                          aria-label={t("desktop.im.revealInWorkbench")}
                        >
                          <ThemeIcon name="file-diff" size={11} aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        )}
        {message.routingTip && (
          <div
            className={`im-routing-tip${message.routingTimedOut ? " is-timeout" : " is-unmatched"}`}
            onClick={onRoutingTipClick}
          >
            <ThemeIcon
              name={message.routingTimedOut ? "history" : "sparkles"}
              size={12}
              aria-hidden="true"
            />
            <span>{t(message.routingTip) || message.routingTip}</span>
          </div>
        )}
        {message.streaming && (
          <span className="im-streaming-cursor" aria-hidden="true" />
        )}
        {isAnswering && cancelTargetJob && (
          <div className="im-generating-bar">
            <button
              type="button"
              className="btn small ghost-btn im-stop-generating-btn"
              onClick={() => void onCancelJob?.(cancelTargetJob)}
              aria-label={t("desktop.im.stopAnswer")}
              title={t("desktop.im.stopAnswer")}
            >
              <ThemeIcon name="square" size={11} aria-hidden="true" />
              <span>{t("desktop.im.stopAnswer")}</span>
            </button>
          </div>
        )}
        {isResumableJob(linkedJob, room?.jobs ?? []) && linkedJob && !isAnswering && (
          <div className="im-interrupted-bar">
            <span>{t("desktop.im.jobInterrupted")}</span>
            <button
              type="button"
              className="btn small primary"
              onClick={() => void onResumeJob(linkedJob)}
            >
              <ThemeIcon name="refresh" size={12} aria-hidden="true" />
              <span>{t("desktop.im.resumeJob")}</span>
            </button>
          </div>
        )}
        {(message.kind === "human" || message.kind === "role.say") && !isAnswering && (
          <div className="im-message-actions">
            <button type="button" className="im-message-action" onClick={() => void onCopyText(message.body)}>
              {t("desktop.common.copy")}
            </button>
            <button type="button" className="im-message-action im-quote-btn" onClick={() => onQuoteMessage(message)}>
              {t("desktop.im.quote")}
            </button>
            <button
              type="button"
              className="im-message-action"
              disabled={isTranslating}
              onClick={() => void onTranslateMessage(message)}
            >
              {translated
                ? t("desktop.im.restore")
                : isTranslating
                  ? t("desktop.im.actionRunning")
                  : t("desktop.im.translate")}
            </button>
            {message.kind === "role.say" && speaker && speaker.enabled && !message.streaming && !isResumableJob(linkedJob, room?.jobs ?? []) && (
              <button
                type="button"
                className="im-message-action"
                disabled={Boolean(room?.jobs.some((job) => job.memberId === speaker.memberId && job.status !== "failed" && job.status !== "cancelled" && job.status !== "completed"))}
                onClick={() => onContinueAsk(message)}
              >
                {t("desktop.im.continueAsk")}
              </button>
            )}
          </div>
        )}
      </article>
    </>
  );
});
