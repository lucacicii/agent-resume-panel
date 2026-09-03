import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent,
  type RefObject
} from "react";
import type { AgentToolDescriptor } from "@agent-resume/core";
import { ThemeIcon } from "../../components/ThemeIcon";
import { ToolSettingsPopover, type AskToolPrefs } from "../../components/ToolSettingsPopover";
import type { ImMember, ImMessage, ImQuotedMessage } from "../../../shared/imTypes";
import { ImFilePicker, type ImFilePickerHandle } from "./ImFilePicker";
import {
  ALLOWED_IMAGE_TYPES,
  MAX_IMAGES,
  MAX_IMAGE_BYTES,
  agentTag,
  formatImHashPath,
  imHashTokenAtCursor,
  readFileAsDataUrl,
  roleColor,
  roleInitial,
  type PendingImage,
  type Translate
} from "./imUtils";

export interface ImComposerProps {
  members: ImMember[];
  draft: string;
  quotes: ImQuotedMessage[];
  followUpTo: ImMessage | null;
  mentionIds: string[];
  pendingImages: PendingImage[];
  sending: boolean;
  mentionOpen: boolean;
  toolPrefs?: AskToolPrefs;
  toolCatalog?: AgentToolDescriptor[] | null;
  projectPath?: string | null;
  onToolPrefsChange?: (prefs: AskToolPrefs) => void;
  setMentionOpen: (val: boolean | ((curr: boolean) => boolean)) => void;
  onDraftChange: (text: string) => void;
  onQuotesChange: (quotes: ImQuotedMessage[] | ((curr: ImQuotedMessage[]) => ImQuotedMessage[])) => void;
  onFollowUpToChange: (msg: ImMessage | null) => void;
  onMentionIdsChange: (ids: string[] | ((curr: string[]) => string[])) => void;
  onPendingImagesChange: (imgs: PendingImage[] | ((curr: PendingImage[]) => PendingImage[])) => void;
  onSend: () => void;
  onPreviewImage: (url: string) => void;
  onError: (error: unknown) => void;
  memberLabel: (member: ImMember) => string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  t: Translate;
}

export const ImComposer = memo(function ImComposer({
  members,
  draft,
  quotes,
  followUpTo,
  mentionIds,
  pendingImages,
  sending,
  mentionOpen,
  toolPrefs = { mode: "auto", enabledTools: [] },
  toolCatalog = null,
  projectPath = null,
  onToolPrefsChange,
  setMentionOpen,
  onDraftChange,
  onQuotesChange,
  onFollowUpToChange,
  onMentionIdsChange,
  onPendingImagesChange,
  onSend,
  onPreviewImage,
  onError,
  memberLabel,
  textareaRef,
  t
}: ImComposerProps) {
  const [mentionIndex, setMentionIndex] = useState(0);
  const [toolsPopoverOpen, setToolsPopoverOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [filePickerDismissed, setFilePickerDismissed] = useState(false);
  const mentionListRef = useRef<HTMLDivElement | null>(null);
  const filePickerRef = useRef<ImFilePickerHandle | null>(null);
  const toolsPopoverRef = useRef<HTMLSpanElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  const toolsEffectiveOn =
    toolPrefs.mode === "auto" ||
    (toolPrefs.mode === "custom" && toolPrefs.enabledTools.length > 0);

  const visibleTools = useMemo(
    () => (toolCatalog ? (projectPath ? toolCatalog : toolCatalog.filter((tool) => tool.category !== "link_graph")) : []),
    [toolCatalog, projectPath]
  );

  useEffect(() => {
    if (!toolsPopoverOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (toolsPopoverRef.current && !toolsPopoverRef.current.contains(event.target as Node)) {
        setToolsPopoverOpen(false);
      }
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setToolsPopoverOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [toolsPopoverOpen]);

  const isSingleRole = members.length === 1;
  const singleMember = isSingleRole ? members[0] : undefined;

  const mentionQuery = useMemo(() => {
    if (isSingleRole) return "";
    const at = draft.lastIndexOf("@");
    if (at < 0) return "";
    const after = draft.slice(at + 1);
    if (/\s/.test(after)) return "";
    return after.trim().toLowerCase();
  }, [draft, isSingleRole]);

  const mentionOptions = useMemo(() => {
    if (isSingleRole) return [];
    return (mentionQuery
      ? members.filter((member) => memberLabel(member).toLowerCase().includes(mentionQuery) || member.agent.includes(mentionQuery))
      : members
    ).filter((member) => !mentionIds.includes(member.memberId));
  }, [isSingleRole, members, mentionIds, mentionQuery, memberLabel]);

  const mentioned = useMemo(() => {
    return mentionIds
      .map((id) => members.find((member) => member.memberId === id))
      .filter((member): member is ImMember => Boolean(member));
  }, [members, mentionIds]);

  const hashToken = useMemo(
    () => (projectPath ? imHashTokenAtCursor(draft, cursor) : null),
    [cursor, draft, projectPath]
  );
  const filePickerOpen = Boolean(hashToken) && !filePickerDismissed;

  // Any edit re-arms the picker after an explicit Escape dismissal.
  useEffect(() => {
    setFilePickerDismissed(false);
  }, [draft]);

  const focusComposerAt = useCallback((position: number) => {
    setCursor(position);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        el.setSelectionRange(position, position);
        el.focus();
      }
    });
  }, [textareaRef]);

  const navigateHash = useCallback((nextQuery: string) => {
    if (!hashToken) return;
    const next = `${draft.slice(0, hashToken.start)}#${nextQuery}${draft.slice(cursor)}`;
    onDraftChange(next);
    focusComposerAt(hashToken.start + 1 + nextQuery.length);
  }, [cursor, draft, focusComposerAt, hashToken, onDraftChange]);

  const selectHashPath = useCallback((relativePath: string) => {
    if (!hashToken) return;
    const inserted = `#${formatImHashPath(relativePath)} `;
    const next = `${draft.slice(0, hashToken.start)}${inserted}${draft.slice(cursor)}`;
    onDraftChange(next);
    setFilePickerDismissed(true);
    focusComposerAt(hashToken.start + inserted.length);
  }, [cursor, draft, focusComposerAt, hashToken, onDraftChange]);

  const pickMention = useCallback((member: ImMember) => {
    const at = draft.lastIndexOf("@");
    const nextDraft = at >= 0 ? `${draft.slice(0, at).trimEnd()} ` : draft;
    const normalized = nextDraft.trimStart();
    onDraftChange(normalized);
    setCursor(normalized.length);
    onMentionIdsChange((current) => current.includes(member.memberId) ? current : [...current, member.memberId]);
    setMentionOpen(false);
    setMentionIndex(0);
    textareaRef.current?.focus();
  }, [draft, onDraftChange, onMentionIdsChange, setMentionOpen, textareaRef]);

  const stageImageFiles = useCallback(async (files: FileList | File[] | null) => {
    if (!files || !files.length) return;
    const incoming = Array.from(files);
    let currentCount = pendingImages.length;
    const next: PendingImage[] = [];

    for (const file of incoming) {
      if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
        onError(new Error(t("desktop.im.imageInvalidType")));
        continue;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        onError(new Error(t("desktop.im.imageTooLarge", file.name)));
        continue;
      }
      if (currentCount >= MAX_IMAGES) {
        onError(new Error(t("desktop.im.tooManyImages", MAX_IMAGES)));
        break;
      }
      try {
        const dataUrl = await readFileAsDataUrl(file);
        const comma = dataUrl.indexOf(",");
        const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
        next.push({
          id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          fileName: file.name,
          mimeType: file.type,
          data: base64,
          previewUrl: dataUrl,
          sizeBytes: file.size
        });
        currentCount += 1;
      } catch (err) {
        onError(err);
      }
    }
    if (next.length) {
      onPendingImagesChange((curr) => [...curr, ...next]);
    }
  }, [onError, onPendingImagesChange, pendingImages.length, t]);

  const onComposerPaste = useCallback((event: ReactClipboardEvent<HTMLTextAreaElement>) => {
    const items = [...(event.clipboardData?.items ?? [])];
    const imageItems = items.filter((item) => item.type.startsWith("image/"));
    if (!imageItems.length) return;
    event.preventDefault();
    const files: File[] = [];
    for (const item of imageItems) {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
    void stageImageFiles(files);
  }, [stageImageFiles]);

  const onDragOver = useCallback((event: ReactDragEvent) => {
    if (event.dataTransfer?.types?.includes("Files")) {
      event.preventDefault();
    }
  }, []);

  const onDrop = useCallback((event: ReactDragEvent) => {
    if (event.dataTransfer?.files?.length) {
      event.preventDefault();
      void stageImageFiles(event.dataTransfer.files);
    }
  }, [stageImageFiles]);

  const onComposerKey = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "@" && !isSingleRole) {
      setMentionOpen(true);
      setMentionIndex(0);
    }
    if (filePickerOpen && filePickerRef.current?.handleKeyDown(event)) return;
    if (mentionOpen && mentionOptions.length) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setMentionIndex((current) => (current + 1) % mentionOptions.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setMentionIndex((current) => (current - 1 + mentionOptions.length) % mentionOptions.length);
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        const selected = mentionOptions[mentionIndex] ?? mentionOptions[0];
        if (selected) pickMention(selected);
        return;
      }
      if (event.key === "Tab") {
        event.preventDefault();
        const selected = mentionOptions[mentionIndex] ?? mentionOptions[0];
        if (selected) pickMention(selected);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSend();
    }
    if (event.key === "Backspace" && !draft && !mentionOpen && mentionIds.length) {
      event.preventDefault();
      onMentionIdsChange((current) => current.slice(0, -1));
      return;
    }
    if (event.key === "Escape") {
      setMentionOpen(false);
      setMentionIndex(0);
    }
  }, [draft, filePickerOpen, mentionIds.length, mentionIndex, mentionOpen, mentionOptions, onMentionIdsChange, onSend, pickMention, setMentionOpen]);

  useEffect(() => {
    if (!mentionOpen) return;
    setMentionIndex((current) => {
      if (!mentionOptions.length) return 0;
      return Math.min(current, mentionOptions.length - 1);
    });
  }, [mentionOpen, mentionOptions.length]);

  useEffect(() => {
    if (!mentionOpen) return;
    const list = mentionListRef.current;
    const option = mentionOptions[mentionIndex];
    if (!list || !option) return;
    const row = document.getElementById(option.memberId);
    if (row && list.contains(row) && typeof row.scrollIntoView === "function") {
      row.scrollIntoView({ block: "nearest" });
    }
  }, [mentionIndex, mentionOpen, mentionOptions]);

  const canSend = !sending && Boolean(draft.trim() || quotes.length || pendingImages.length);

  return (
    <div className="chat-compose im-composer" onDragOver={onDragOver} onDrop={onDrop}>
      <input
        ref={imageInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          void stageImageFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <div className="chat-compose-frame">
        <div className="chat-compose-field">
          {mentionOpen && !filePickerOpen && mentionOptions.length > 0 && (
            <div
              ref={mentionListRef}
              className="im-mention-menu"
              role="listbox"
              aria-label={t("desktop.im.mention")}
              aria-activedescendant={mentionOptions[mentionIndex]?.memberId}
            >
              {mentionOptions.map((member, index) => (
                <button
                  key={member.memberId}
                  id={member.memberId}
                  type="button"
                  role="option"
                  aria-selected={index === mentionIndex}
                  className={index === mentionIndex ? "active" : undefined}
                  onMouseEnter={() => setMentionIndex(index)}
                  onClick={() => pickMention(member)}
                >
                  <span
                    className="im-role-avatar"
                    aria-hidden="true"
                    style={{ "--im-role-color": roleColor(member.templateId) } as CSSProperties}
                  >
                    {roleInitial(memberLabel(member))}
                  </span>
                  @{memberLabel(member)} {agentTag(member.agent, member.model, t)}
                </button>
              ))}
            </div>
          )}
          {filePickerOpen && hashToken && (
            <ImFilePicker
              ref={filePickerRef}
              projectPath={projectPath || ""}
              query={hashToken.query}
              onNavigate={navigateHash}
              onSelect={selectHashPath}
              onDismiss={() => setFilePickerDismissed(true)}
              t={t}
            />
          )}
          {pendingImages.length > 0 && (
            <div className="im-pending-images" aria-label="Attached images">
              {pendingImages.map((img) => (
                <div key={img.id} className="im-pending-image-card">
                  <img src={img.previewUrl} alt={img.fileName} onClick={() => onPreviewImage(img.previewUrl)} />
                  <span className="im-pending-image-name" title={img.fileName}>{img.fileName}</span>
                  <button
                    type="button"
                    className="im-pending-image-remove"
                    onClick={() => onPendingImagesChange((curr) => curr.filter((item) => item.id !== img.id))}
                    aria-label={t("desktop.common.delete")}
                  >
                    <ThemeIcon name="close" size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}
          {followUpTo && (
            <div className="im-quote-chips">
              <button
                type="button"
                className="im-quote-chip im-followup-chip"
                onClick={() => {
                  onFollowUpToChange(null);
                  onMentionIdsChange([]);
                }}
                aria-label={t("desktop.im.removeFollowUp")}
              >
                {t("desktop.im.continuingWith", followUpTo.authorLabel)}
                <ThemeIcon name="close" size={12} aria-hidden="true" />
              </button>
            </div>
          )}
          {quotes.length > 0 && (
            <div className="im-quote-chips">
              {quotes.map((quote) => (
                <button
                  key={quote.messageId}
                  type="button"
                  className="im-quote-chip"
                  onClick={() => onQuotesChange((current) => current.filter((item) => item.messageId !== quote.messageId))}
                  aria-label={t("desktop.im.removeQuote")}
                >
                  {quote.authorLabel}: {quote.body.slice(0, 40)}
                  <ThemeIcon name="close" size={12} aria-hidden="true" />
                </button>
              ))}
            </div>
          )}
          {mentioned.length > 0 && (
            <div className="im-quote-chips">
              {mentioned.map((member) => (
                <button
                  key={member.memberId}
                  type="button"
                  className="im-mention-chip"
                  onClick={() => onMentionIdsChange((current) => current.filter((id) => id !== member.memberId))}
                  aria-label={t("desktop.im.removeMention")}
                >
                  @{memberLabel(member)}
                  <ThemeIcon name="close" size={12} />
                </button>
              ))}
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(event) => {
              onDraftChange(event.target.value);
              setCursor(event.target.selectionStart || event.target.value.length);
            }}
            onSelect={(event) => setCursor(event.currentTarget.selectionStart ?? 0)}
            onClick={(event) => setCursor(event.currentTarget.selectionStart ?? 0)}
            onKeyDown={onComposerKey}
            onPaste={onComposerPaste}
            placeholder={
              singleMember
                ? t("desktop.im.placeholderSingle", memberLabel(singleMember))
                : t("desktop.im.placeholder")
            }
            aria-label={
              singleMember
                ? t("desktop.im.placeholderSingle", memberLabel(singleMember))
                : t("desktop.im.placeholder")
            }
            rows={1}
          />
        </div>
        <div className="chat-compose-toolbar">
          <button
            type="button"
            className="chat-tools-toggle"
            onClick={() => imageInputRef.current?.click()}
            title={t("desktop.im.addImage")}
            aria-label={t("desktop.im.addImage")}
          >
            <ThemeIcon name="file-image" size={16} aria-hidden="true" />
          </button>
          {!isSingleRole && (
            <button
              type="button"
              className={`chat-tools-toggle im-mention-btn${mentionOpen ? " active" : ""}`}
              onClick={() => {
                setMentionOpen((open) => !open);
                setMentionIndex(0);
                textareaRef.current?.focus();
              }}
              title={t("desktop.im.mention")}
              aria-label={t("desktop.im.mention")}
            >
              <ThemeIcon name="at-sign" size={16} aria-hidden="true" />
            </button>
          )}
          <span className="chat-tools-wrap" ref={toolsPopoverRef}>
            <button
              type="button"
              className={`chat-tools-toggle${toolsEffectiveOn ? " active" : ""}`}
              title={toolsEffectiveOn ? t("desktop.agent.toolsOn") : t("desktop.agent.toolsOffTitle")}
              aria-label={t("desktop.agent.toolsToggle")}
              aria-pressed={toolsEffectiveOn}
              aria-expanded={toolsPopoverOpen}
              aria-haspopup="dialog"
              disabled={sending}
              onClick={() => setToolsPopoverOpen((value) => !value)}
            >
              <ThemeIcon name="wrench" size={16} />
            </button>
            {toolsPopoverOpen && onToolPrefsChange && (
              <ToolSettingsPopover
                prefs={toolPrefs}
                tools={visibleTools}
                onPrefsChange={onToolPrefsChange}
                onClose={() => setToolsPopoverOpen(false)}
                t={t}
              />
            )}
          </span>
          <span className="chat-compose-toolbar-spacer" />
          <button
            type="button"
            className="chat-send-btn"
            onClick={onSend}
            disabled={!canSend}
            aria-label={t("desktop.common.send")}
          >
            <ThemeIcon name="send" size={18} />
          </button>
        </div>
      </div>
    </div>
  );
});
