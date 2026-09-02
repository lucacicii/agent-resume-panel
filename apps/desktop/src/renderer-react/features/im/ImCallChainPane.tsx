import { useMemo, useState, type CSSProperties, type JSX } from "react";
import { ThemeIcon } from "../../components/ThemeIcon";
import type { ImMember, ImRoom } from "../../../shared/imTypes";
import { formatDay, formatTime, roleColor, roleInitial, roleLabel, type Translate } from "./imUtils";
import { buildCallChains, type CallChainGroup, type CallChainNode, type CallNodeStatus, type CallTriggerType } from "./callChainModel";

interface ImCallChainPaneProps {
  room: ImRoom | null;
  allMembers: ImMember[];
  onJumpToMessage: (messageId: string) => void;
  onClose?: () => void;
  t: Translate;
}

function triggerLabel(triggerType: CallTriggerType, t: Translate): string {
  switch (triggerType) {
    case "auto_dispatched":
      return t("desktop.im.callChainAutoDispatched");
    case "manual_dispatched":
      return t("desktop.im.callChainManualDispatched");
    case "auto_routed":
      return t("desktop.im.callChainAutoRouted");
    case "mention":
      return t("desktop.im.callChainMentioned");
    case "user_prompt":
      return t("desktop.im.callChainUserPrompt");
    case "follow_up":
      return t("desktop.im.callChainFollowUp");
    case "pending_proposal":
      return t("desktop.im.callChainPendingProposal");
    case "quote_handoff":
      return t("desktop.im.quote");
    default:
      return triggerType;
  }
}

function statusBadge(status: CallNodeStatus | undefined, t: Translate): JSX.Element | null {
  if (!status) return null;
  switch (status) {
    case "running":
      return <span className="im-chain-status is-running">{t("desktop.im.job.running")}</span>;
    case "queued":
      return <span className="im-chain-status is-queued">{t("desktop.im.job.queued")}</span>;
    case "failed":
      return <span className="im-chain-status is-failed">{t("desktop.im.job.failed")}</span>;
    case "cancelled":
      return <span className="im-chain-status is-cancelled">{t("desktop.im.job.cancelled")}</span>;
    case "pending_proposal":
      return <span className="im-chain-status is-pending">{t("desktop.im.delegationStatus.pending")}</span>;
    case "completed":
    default:
      return null;
  }
}

export function ImCallChainPane({
  room,
  allMembers,
  onJumpToMessage,
  onClose,
  t
}: ImCallChainPaneProps): JSX.Element {
  const [collapsedChains, setCollapsedChains] = useState<Set<string>>(new Set());
  const [filterText, setFilterText] = useState("");

  const summary = useMemo(() => {
    if (!room) return { chains: [], totalChains: 0, totalNodes: 0, activeCount: 0 };
    return buildCallChains(room.messages, room.jobs, allMembers, {
      roleColor,
      memberLabel: (m) => roleLabel(m, t),
      roleInitial,
      formatTime,
      formatDay: (ms) => formatDay(ms, t)
    });
  }, [allMembers, room, t]);

  const toggleCollapse = (chainId: string) => {
    setCollapsedChains((prev) => {
      const next = new Set(prev);
      if (next.has(chainId)) next.delete(chainId);
      else next.add(chainId);
      return next;
    });
  };

  const filteredChains = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    if (!q) return summary.chains;
    return summary.chains.filter((chain) => {
      if (chain.title.toLowerCase().includes(q)) return true;
      function matchNode(node: CallChainNode): boolean {
        if (node.authorLabel.toLowerCase().includes(q) || node.snippet.toLowerCase().includes(q)) return true;
        if (node.reason && node.reason.toLowerCase().includes(q)) return true;
        if (node.filesChanged?.some((f) => f.toLowerCase().includes(q))) return true;
        return node.children.some(matchNode);
      }
      return matchNode(chain.root);
    });
  }, [filterText, summary.chains]);

  function renderNode(node: CallChainNode, isRoot: boolean): JSX.Element {
    const isHuman = node.kind === "human";
    const isProposal = node.kind === "proposal";
    const roleStyle = node.roleColor
      ? ({ "--im-chain-role-color": node.roleColor } as CSSProperties)
      : undefined;

    return (
      <div
        key={node.id}
        className={`im-chain-node-wrap depth-${node.depth}${isRoot ? " is-root" : ""}`}
      >
        <div
          className={`im-chain-card kind-${node.kind}${node.status ? ` status-${node.status}` : ""}`}
          style={roleStyle}
          role="button"
          tabIndex={0}
          onClick={() => onJumpToMessage(node.messageId)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onJumpToMessage(node.messageId);
            }
          }}
          title={t("desktop.im.jumpToMessage")}
        >
          <div className="im-chain-card-header">
            <div className="im-chain-avatar-badge" aria-hidden="true">
              {isHuman ? (
                <ThemeIcon name="user" size={12} />
              ) : isProposal ? (
                <ThemeIcon name="waypoints" size={12} />
              ) : (
                <span className="im-chain-role-initial">{node.roleInitial}</span>
              )}
            </div>
            <span className="im-chain-author">{node.authorLabel}</span>
            <span className={`im-chain-trigger-tag type-${node.triggerType}`}>
              {triggerLabel(node.triggerType, t)}
            </span>
            {statusBadge(node.status, t)}
            <span className="im-chain-time">{node.timeLabel}</span>
          </div>

          {node.reason ? (
            <div className="im-chain-reason">
              <span className="im-chain-reason-label">{t("desktop.im.delegationReason")}:</span> {node.reason}
            </div>
          ) : null}

          <div className="im-chain-snippet">{node.snippet}</div>

          {node.filesChanged && node.filesChanged.length > 0 ? (
            <div className="im-chain-files">
              <ThemeIcon name="file-code" size={11} aria-hidden="true" />
              <span className="im-chain-files-count">
                {t("desktop.im.callChainFilesChanged", node.filesChanged.length)}
              </span>
            </div>
          ) : null}
        </div>

        {node.children.length > 0 ? (
          <div className="im-chain-children">
            {node.children.map((child) => renderNode(child, false))}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <aside className="wb-side-pane im-call-chain-pane" aria-label={t("desktop.im.callChain")}>
      <header className="wb-side-pane-header im-call-chain-header">
        <div className="im-call-chain-title-wrap">
          <ThemeIcon name="waypoints" size={15} aria-hidden="true" />
          <span className="wb-side-pane-title">{t("desktop.im.callChain")}</span>
          {summary.totalChains > 0 ? (
            <span className="im-call-chain-badge" title={t("desktop.im.callChainCount", summary.totalChains, summary.totalNodes)}>
              {summary.totalChains} / {summary.totalNodes}
            </span>
          ) : null}
        </div>
        <div className="wb-side-pane-actions">
          {onClose ? (
            <button
              type="button"
              className="wb-detail-tool ghost-btn"
              onClick={onClose}
              aria-label={t("desktop.common.close")}
              title={t("desktop.common.close")}
            >
              <ThemeIcon name="close" size={14} />
            </button>
          ) : null}
        </div>
      </header>

      {summary.totalChains > 1 ? (
        <div className="im-call-chain-search">
          <ThemeIcon name="search" size={12} className="search-icon" aria-hidden="true" />
          <input
            type="search"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder={t("desktop.common.search")}
            aria-label={t("desktop.common.search")}
          />
        </div>
      ) : null}

      <div className="im-call-chain-body">
        {summary.totalChains === 0 ? (
          <div className="im-chain-empty">
            <div className="im-chain-empty-icon" aria-hidden="true">
              <ThemeIcon name="waypoints" size={28} />
            </div>
            <p className="im-chain-empty-title">{t("desktop.im.callChainEmpty")}</p>
            <p className="im-chain-empty-hint">{t("desktop.im.callChainEmptyHint")}</p>
          </div>
        ) : filteredChains.length === 0 ? (
          <p className="im-chain-empty-hint">{t("desktop.im.callChainNoResults")}</p>
        ) : (
          <div className="im-chain-groups-list">
            {filteredChains.map((chain: CallChainGroup, index: number) => {
              const isCollapsed = collapsedChains.has(chain.chainId);
              return (
                <section key={chain.chainId} className="im-chain-group">
                  <header
                    className="im-chain-group-header"
                    onClick={() => toggleCollapse(chain.chainId)}
                    role="button"
                    tabIndex={0}
                    aria-expanded={!isCollapsed}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        toggleCollapse(chain.chainId);
                      }
                    }}
                  >
                    <button
                      type="button"
                      className="im-chain-group-collapse-btn"
                      tabIndex={-1}
                      aria-hidden="true"
                    >
                      <ThemeIcon name={isCollapsed ? "chevron-right" : "chevron-down"} size={12} />
                    </button>
                    <span className="im-chain-group-index">#{filteredChains.length - index}</span>
                    <span className="im-chain-group-title" title={chain.title}>{chain.title}</span>
                    <span className="im-chain-group-meta">
                      {chain.timeLabel} · {chain.totalNodes}
                    </span>
                  </header>

                  {!isCollapsed ? (
                    <div className="im-chain-group-content">
                      {renderNode(chain.root, true)}
                    </div>
                  ) : null}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}
