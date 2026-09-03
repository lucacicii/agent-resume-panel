import { memo, useMemo, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import { ThemeIcon } from "../../components/ThemeIcon";
import { renderMarkdown } from "../../components/Markdown";
import { StreamdownRenderer } from "../../components/StreamdownRenderer";
import { desktopApi } from "../../bridge";
import type { ImJob, ImMember, ImMessage, ImRoom } from "../../../shared/imTypes";
import { extractCitationsFromMessage } from "./CitationSheet";
import type { MessageGraphMeta } from "./imTranscriptGraphModel";
import {
  agentTag,
  cleanSnippet,
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
  isExpanded?: boolean;
  depth?: number;
  graphMeta?: MessageGraphMeta;
  isThinkingExpanded: boolean;
  isFilesExpanded: boolean;
  copiedFilePath: string | null;
  memberLabel: (member: ImMember) => string;
  onJumpToMessage?: (messageId: string) => void;
  onConfigureRole?: (member: ImMember, anchorRect: DOMRect) => void;
  onToggleExpand?: (messageId: string) => void;
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
  onOpenCitations?: (message: ImMessage, marker?: string) => void;
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
  isExpanded = true,
  depth = 0,
  graphMeta,
  isThinkingExpanded,
  isFilesExpanded,
  copiedFilePath,
  memberLabel,
  onJumpToMessage,
  onConfigureRole,
  onToggleExpand,
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
  onOpenCitations,
  t
}: ImMessageItemProps) {
  const speaker = useMemo(() => {
    if (!allMembers.length) return undefined;
    const authorId = message.authorMemberId?.trim();
    const label = message.authorLabel?.trim();
    const lowerLabel = label?.toLowerCase();

    return (
      allMembers.find((m) => authorId && (m.memberId === authorId || m.templateId === authorId)) ||
      allMembers.find((m) => label && (m.name === label || roleLabel(m, t) === label)) ||
      allMembers.find((m) => lowerLabel && (
        m.name.toLowerCase() === lowerLabel ||
        m.templateId.toLowerCase() === lowerLabel ||
        m.templateId.replace(/^role_/, "").toLowerCase() === lowerLabel
      ))
    );
  }, [allMembers, message.authorLabel, message.authorMemberId, t]);

  const roleColorValue = speaker ? roleColor(speaker.templateId) : (message.kind === "role.say" ? roleColor(message.authorLabel) : undefined);
  const showDate = !prevMessage || dayKey(prevMessage.createdAtMs) !== dayKey(message.createdAtMs);
  const showThreadBreak = Boolean(
    message.threadId &&
    prevMessage?.threadId &&
    prevMessage.threadId !== message.threadId
  );

  const linkedJob = message.jobId ? room?.jobs.find((j) => j.jobId === message.jobId) : undefined;
  const isMessageStreaming = Boolean(message.streaming);
  const isLinkedJobActive = Boolean(linkedJob && isActiveJobStatus(linkedJob.status));
  const isAnswering = isMessageStreaming || isLinkedJobActive;
  const isResumable = Boolean(linkedJob && isResumableJob(linkedJob, room?.jobs ?? []));
  const cancelTargetJob = isLinkedJobActive ? linkedJob : (isMessageStreaming && message.jobId ? ({ jobId: message.jobId } as ImJob) : undefined);
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

  const citations = useMemo(() => {
    return extractCitationsFromMessage(message, room);
  }, [message, room]);

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

  const isSingleRole = useMemo(() => {
    const enabled = room?.members?.filter((m) => m.enabled) ?? [];
    return enabled.length === 1;
  }, [room?.members]);

  const renderActions = () => {
    if (message.kind !== "human" && message.kind !== "role.say") return null;
    if (isAnswering) return null;

    return (
      <div className="im-compact-actions">
        {message.kind === "role.say" && !isResumable && !isSingleRole && (
          <button
            type="button"
            className="im-compact-action-btn im-continue-ask-btn"
            onClick={(e) => {
              e.stopPropagation();
              onContinueAsk(message);
            }}
            title={t("desktop.im.continueAsk")}
          >
            <ThemeIcon name="corner-down-right" size={11} aria-hidden="true" />
            <span>{t("desktop.im.continueAsk")}</span>
          </button>
        )}
        <button
          type="button"
          className="im-compact-action-btn im-quote-btn"
          onClick={(e) => {
            e.stopPropagation();
            onQuoteMessage(message);
          }}
          title={t("desktop.im.quote")}
        >
          <ThemeIcon name="quote" size={11} aria-hidden="true" />
          <span>{t("desktop.im.quote")}</span>
        </button>
        <button
          type="button"
          className="im-compact-action-btn"
          disabled={isTranslating}
          onClick={(e) => {
            e.stopPropagation();
            void onTranslateMessage(message);
          }}
          title={translated ? t("desktop.im.restore") : t("desktop.im.translate")}
        >
          <ThemeIcon name="globe" size={11} aria-hidden="true" />
          <span>
            {translated
              ? t("desktop.im.restore")
              : isTranslating
                ? t("desktop.im.actionRunning")
                : t("desktop.im.translate")}
          </span>
        </button>
        <button
          type="button"
          className="im-compact-action-btn"
          onClick={(e) => {
            e.stopPropagation();
            void onCopyText(cleanBody || message.body);
          }}
          title={t("desktop.common.copy")}
        >
          <ThemeIcon name="copy" size={11} aria-hidden="true" />
          <span>{t("desktop.common.copy")}</span>
        </button>
      </div>
    );
  };

  const parentMsg = graphMeta?.parentMessageId
    ? room?.messages.find((m) => m.messageId === graphMeta.parentMessageId)
    : undefined;

  const renderOriginCapsule = () => {
    if (!parentMsg) return null;
    const parentSpeaker = parentMsg.authorMemberId
      ? allMembers.find((m) => m.memberId === parentMsg.authorMemberId || m.templateId === parentMsg.authorMemberId)
      : allMembers.find((m) => m.name === parentMsg.authorLabel || roleLabel(m, t) === parentMsg.authorLabel);

    const parentLabel = parentSpeaker ? memberLabel(parentSpeaker) : (parentMsg.authorLabel || "You");
    const parentColor = parentSpeaker ? roleColor(parentSpeaker.templateId) : undefined;
    const parentSnippet = cleanSnippet(parentMsg.body || "", 70);

    return (
      <div
        className="im-origin-capsule"
        role="button"
        tabIndex={0}
        onClick={(e) => {
          e.stopPropagation();
          onJumpToMessage?.(parentMsg.messageId);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            onJumpToMessage?.(parentMsg.messageId);
          }
        }}
        title={t("desktop.im.jumpToMessage")}
      >
        <span className="im-origin-arrow" aria-hidden="true">↳</span>
        <span className="im-origin-author">
          {parentColor ? (
            <span className="im-origin-avatar-dot" style={{ background: parentColor }} aria-hidden="true" />
          ) : (
            <span className="im-origin-user-dot" aria-hidden="true"><ThemeIcon name="user" size={10} /></span>
          )}
          <strong>{parentLabel}</strong>
        </span>
        <span className="im-origin-sep" aria-hidden="true">:</span>
        <span className="im-origin-snippet">{parentSnippet}</span>
        {graphMeta?.triggerKind === "auto_dispatched" ? (
          <span className="im-origin-trigger-tag type-auto_dispatched">
            <ThemeIcon name="zap" size={9} aria-hidden="true" />
            <span>{t("desktop.im.callChainAutoDispatched")}</span>
          </span>
        ) : graphMeta?.triggerKind === "auto_routed" ? (
          <span className="im-origin-trigger-tag type-auto_routed">
            <ThemeIcon name="sparkles" size={9} aria-hidden="true" />
            <span>{t("desktop.im.callChainAutoRouted")}</span>
          </span>
        ) : graphMeta?.triggerKind === "mention" ? (
          <span className="im-origin-trigger-tag type-mention">
            <ThemeIcon name="at-sign" size={9} aria-hidden="true" />
            <span>{t("desktop.im.callChainMentioned")}</span>
          </span>
        ) : graphMeta?.triggerKind === "follow_up" ? (
          <span className="im-origin-trigger-tag type-follow_up">
            <ThemeIcon name="corner-down-right" size={9} aria-hidden="true" />
            <span>{t("desktop.im.callChainFollowUp")}</span>
          </span>
        ) : null}
      </div>
    );
  };

  const renderRoleHeaderExternal = () => {
    if (message.kind !== "role.say") return null;
    const authorName = speaker ? memberLabel(speaker) : message.authorLabel;

    return (
      <header className="im-role-header-external">
        <span className="im-message-author">
          {roleColorValue ? (
            <button
              type="button"
              className="im-role-avatar is-large is-clickable"
              style={{ "--im-role-color": roleColorValue } as CSSProperties}
              onClick={(e) => {
                e.stopPropagation();
                if (speaker) {
                  const rect = e.currentTarget.getBoundingClientRect();
                  onConfigureRole?.(speaker, rect);
                }
              }}
              aria-label={t("desktop.im.configRole")}
              title={speaker ? t("desktop.im.configRoleForChat", memberLabel(speaker)) : authorName}
            >
              {roleInitial(authorName)}
            </button>
          ) : (
            <span className="im-role-avatar is-large" aria-hidden="true">
              {roleInitial(authorName)}
            </span>
          )}
          <strong className="im-role-author-name">{authorName}</strong>
          {speaker ? <span className="im-compact-agent-tag">{agentTag(speaker.agent, speaker.model, t)}</span> : null}
          {!isExpanded && filesChanged.length > 0 && (
            <span className="im-compact-files-badge">
              <ThemeIcon name="file-code" size={11} aria-hidden="true" />
              <span>{t("desktop.im.filesModified", filesChanged.length)}</span>
            </span>
          )}
          {!isExpanded && citations.length > 0 && (
            <span className="im-compact-citations-badge">
              <ThemeIcon name="file-text" size={11} aria-hidden="true" />
              <span>{citations.length}</span>
            </span>
          )}
          <span className="im-header-dot-sep" aria-hidden="true">·</span>
          <time dateTime={new Date(message.createdAtMs).toISOString()} className="im-message-time">
            {formatTime(message.createdAtMs)}
          </time>
          {onToggleExpand && (
            <button
              type="button"
              className="im-message-collapse-btn is-prominent"
              onClick={(e) => {
                e.stopPropagation();
                onToggleExpand(message.messageId);
              }}
              aria-label={t(isExpanded ? "desktop.im.collapseMessage" : "desktop.im.expandMessage")}
              title={t(isExpanded ? "desktop.im.collapseMessage" : "desktop.im.expandMessage")}
            >
              <ThemeIcon name={isExpanded ? "chevron-up" : "chevron-down"} size={16} aria-hidden="true" />
            </button>
          )}
        </span>
      </header>
    );
  };

  const renderHumanHeaderExternal = () => {
    if (message.kind !== "human") return null;

    return (
      <header className="im-human-header-external">
        <span className="im-message-author">
          {onToggleExpand && (
            <button
              type="button"
              className="im-message-collapse-btn is-prominent"
              onClick={(e) => {
                e.stopPropagation();
                onToggleExpand(message.messageId);
              }}
              aria-label={t(isExpanded ? "desktop.im.collapseMessage" : "desktop.im.expandMessage")}
              title={t(isExpanded ? "desktop.im.collapseMessage" : "desktop.im.expandMessage")}
            >
              <ThemeIcon name={isExpanded ? "chevron-up" : "chevron-down"} size={16} aria-hidden="true" />
            </button>
          )}
          <time dateTime={new Date(message.createdAtMs).toISOString()} className="im-message-time">
            {formatTime(message.createdAtMs)}
          </time>
          <span className="im-header-dot-sep" aria-hidden="true">·</span>
          {message.autoRouted && message.routedRoleName ? (
            <span className="im-auto-routed-badge" title={t("desktop.im.autoRoutedTo", message.routedRoleName)}>
              <ThemeIcon name="sparkles" size={11} aria-hidden="true" />
              <span>{t("desktop.im.autoRoutedTo", message.routedRoleName)}</span>
            </span>
          ) : null}
          <strong className="im-human-author-name">{message.authorLabel || "You"}</strong>
          <span className="im-role-avatar is-user" aria-hidden="true">
            <ThemeIcon name="user" size={14} />
          </span>
        </span>
      </header>
    );
  };

  if (message.kind === "system") {
    return (
      <>
        {showDate && (
          <div className="im-date-separator" aria-hidden="true">{formatDay(message.createdAtMs, t)}</div>
        )}
        {showThreadBreak && (
          <div className="im-thread-separator" role="separator">{t("desktop.im.newConversation")}</div>
        )}
        <div className="im-message-row is-system">
          <article
            id={`im-msg-${message.messageId}`}
            className="im-message is-system"
          >
            {displayBody}
          </article>
        </div>
      </>
    );
  }

  const compactSnippet = cleanSnippet(cleanBody || message.body || "");

  return (
    <>
      {showDate && (
        <div className="im-date-separator" aria-hidden="true">{formatDay(message.createdAtMs, t)}</div>
      )}
      {showThreadBreak && (
        <div className="im-thread-separator" role="separator">{t("desktop.im.newConversation")}</div>
      )}
      <div className={`im-message-row is-${message.kind.replace(".", "-")}${!isExpanded ? " is-row-collapsed" : ""}`}>
        <div className="im-message-card-wrap">
          {message.kind === "role.say" ? renderRoleHeaderExternal() : renderHumanHeaderExternal()}
          <article
            id={`im-msg-${message.messageId}`}
            className={`im-message is-${message.kind.replace(".", "-")}${!isExpanded ? " is-collapsed" : ""}${isFlashing ? " is-flashing" : ""}`}
            style={roleColorValue ? { "--im-role-color": roleColorValue } as CSSProperties : undefined}
            onClick={!isExpanded ? () => onToggleExpand?.(message.messageId) : undefined}
            onContextMenu={(event) => onOpenSelectionMenu(event, message)}
            role={!isExpanded ? "button" : undefined}
            tabIndex={!isExpanded ? 0 : undefined}
            title={!isExpanded ? t("desktop.im.expandMessage") : undefined}
          >
            {renderOriginCapsule()}

          {!isExpanded ? (
            <>
              {graphMeta?.triggerReason ? (
                <div className="im-compact-reason">
                  <span className="im-compact-reason-label">{t("desktop.im.delegationReason")}:</span> {graphMeta.triggerReason}
                </div>
              ) : null}
              {compactSnippet ? (
                <div className="im-compact-snippet">{compactSnippet}</div>
              ) : null}
            </>
          ) : (
            <>
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
        {cleanBody ? (
          <StreamdownRenderer
            content={cleanBody}
            isAnimating={Boolean(message.streaming)}
            className="markdown-body"
            onCitationClick={(marker) => {
              if (onOpenCitations) {
                onOpenCitations(message, marker);
                return;
              }
              const prefix = marker.charAt(0);
              if (prefix === "N") {
                window.dispatchEvent(new CustomEvent("agent-resume:tab-request", { detail: "notes" }));
              } else if (prefix === "S") {
                window.dispatchEvent(new CustomEvent("agent-resume:tab-request", { detail: "workbench" }));
              } else if (prefix === "D") {
                window.dispatchEvent(new CustomEvent("agent-resume:tab-request", { detail: "report" }));
              }
            }}
            onNoteClick={(noteId) => {
              window.dispatchEvent(new CustomEvent("agent-resume:tab-request", { detail: "notes" }));
              window.dispatchEvent(new CustomEvent("agent-resume:open-note", { detail: noteId }));
            }}
          />
        ) : null}
        {citations.length > 0 && (
          <div className="im-message-citations-bar">
            <button
              type="button"
              className="im-citations-pill"
              onClick={() => onOpenCitations?.(message)}
              title={t("desktop.im.citationsTitle", "Citations")}
            >
              <ThemeIcon name="file-text" size={13} aria-hidden="true" />
              <span>{t("desktop.im.citationCount", `${citations.length} citations`, citations.length)}</span>
            </button>
          </div>
        )}
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
            </>
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
        {renderActions()}
      </article>
      </div>
      </div>
    </>
  );
});
