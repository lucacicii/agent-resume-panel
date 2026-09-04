import { ThemeIcon } from "../../components/ThemeIcon";
import { ProviderIcon } from "../../components/ProviderIcon";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { desktopApi } from "../../bridge";
import { renderMarkdown } from "../../components/Markdown";
import { Sheet } from "../../components/Sheet";
import { notifyDesktop } from "../../components/Notifications";
import { useI18n } from "../../i18n";
import { toolCallLabel } from "./toolLabels";

type Translate = (key: string, ...args: Array<string | number>) => string;

export type AcpChatPaneProps = {
  recordId: string;
  provider: string;
  projectPath: string;
  title: string;
  active: boolean;
  initialPrompt?: string;
  onTitleChange?: (title: string) => void;
  onSessionReady?: (acpSessionId: string) => void;
  onInitialPromptSubmitted?: () => void;
};

type ToolCall = {
  toolCallId: string;
  title?: string;
  kind?: string;
  status: string;
  rawInput?: unknown;
};

type ImageAttachment = {
  id: string;
  mimeType: string;
  fileName: string;
  storagePath: string;
};

type FileAttachment = {
  id: string;
  mimeType: string;
  fileName: string;
  absolutePath?: string;
  storagePath?: string;
  sizeBytes?: number;
};

type ChatMessage = {
  id: string;
  role: string;
  text: string;
  timestamp: number;
  images?: ImageAttachment[];
  files?: FileAttachment[];
  toolCalls?: ToolCall[];
  streaming?: boolean;
};

type PermissionRequest = {
  requestId: string;
  title: string;
  options: Array<{ optionId: string; name: string; kind: string }>;
};

type UserQuestionOption = {
  label: string;
  description?: string;
  preview?: string;
};

type UserQuestionItem = {
  question: string;
  options: UserQuestionOption[];
  multiSelect?: boolean;
};

type UserQuestionRequest = {
  requestId: string;
  questions: UserQuestionItem[];
};

type PlanPreviewState = {
  content: string;
  path?: string;
  updatedAt: number;
  source: "file" | "message";
};

type ModeOption = { id: string; name: string };

type ConfigSelectOption = { value: string; name: string };
type ConfigSelectGroup = { group: string; name: string; options: ConfigSelectOption[] };
type ConfigOption =
  | {
      type: "select";
      id: string;
      name: string;
      category?: string | null;
      currentValue: string;
      options: Array<ConfigSelectOption | ConfigSelectGroup>;
    }
  | {
      type: "boolean";
      id: string;
      name: string;
      category?: string | null;
      currentValue: boolean;
    };

type ModelsState = {
  currentModelId: string;
  availableModels: Array<{ modelId: string; name: string }>;
};

type AvailableCommand = {
  name: string;
  description: string;
  inputHint?: string;
};

type PendingImage = {
  kind: "image";
  id: string;
  mimeType: string;
  fileName: string;
  data: string;
  previewUrl: string;
};

type PendingFile = {
  kind: "file";
  id: string;
  mimeType: string;
  fileName: string;
  absolutePath?: string;
  data?: string;
  sizeBytes: number;
};

type PendingAttachment = PendingImage | PendingFile;

const MAX_IMAGES = 4;
const MAX_FILES = 10;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const IMAGE_MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function providerLabel(provider: string, t: Translate): string {
  const key = `desktop.workbench.acpProvider.${provider}`;
  const label = t(key);
  return label === key ? provider : label;
}

function newId(): string {
  return crypto.randomUUID();
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatMessageTime(timestamp: number): string {
  if (!timestamp || !Number.isFinite(timestamp)) return "";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(date);
}

function dayKey(timestamp: number): string {
  if (!timestamp || !Number.isFinite(timestamp)) return "";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function formatDaySeparator(timestamp: number): string {
  if (!timestamp || !Number.isFinite(timestamp)) return "";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const today =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (today) {
    return new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(date);
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate();
  if (isYesterday) {
    return new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(date);
  }
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "long",
    ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" as const } : {})
  }).format(date);
}

function isOutboundRole(role: string): boolean {
  return role === "user";
}

/** Sequential bouncing dots while the model is answering. */
function JumpingDots({ label }: { label?: string }): React.JSX.Element {
  return (
    <span className="wb-acp-jumping-dots" role="status" aria-live="polite" aria-label={label || "…"}>
      <span className="wb-acp-jumping-dot" aria-hidden="true" />
      <span className="wb-acp-jumping-dot" aria-hidden="true" />
      <span className="wb-acp-jumping-dot" aria-hidden="true" />
      <span className="wb-acp-jumping-dot" aria-hidden="true" />
      <span className="wb-acp-jumping-dot" aria-hidden="true" />
      <span className="wb-acp-jumping-dot" aria-hidden="true" />
    </span>
  );
}

function AcpToolChip({ tool, t }: { tool: ToolCall; t: Translate }): React.JSX.Element {
  const label = toolCallLabel(tool, t);
  const labelRef = useRef<HTMLSpanElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [expandable, setExpandable] = useState(false);

  useLayoutEffect(() => {
    if (expanded) return;
    const el = labelRef.current;
    if (!el) return;
    const measure = () => {
      setExpandable(el.scrollHeight > el.clientHeight + 1);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [expanded, label]);

  const canToggle = expandable || expanded;

  return (
    <button
      type="button"
      className={`wb-acp-tool ${tool.status}${canToggle ? " is-expandable" : ""}${expanded ? " is-expanded" : ""}`}
      title={label}
      aria-expanded={canToggle ? expanded : undefined}
      onClick={() => {
        if (!canToggle) return;
        setExpanded((value) => !value);
      }}
    >
      {tool.status === "in_progress" || tool.status === "pending" ? (
        <ThemeIcon name="loader" size={12} className="spin" aria-hidden="true" />
      ) : tool.status === "completed" ? (
        <ThemeIcon name="check" size={12} aria-hidden="true" />
      ) : (
        <ThemeIcon name="close" size={12} aria-hidden="true" />
      )}
      <span ref={labelRef} className="wb-acp-tool-label">
        {label}
      </span>
    </button>
  );
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const area = document.createElement("textarea");
  area.value = value;
  area.style.position = "fixed";
  area.style.left = "-9999px";
  document.body.appendChild(area);
  area.select();
  document.execCommand("copy");
  area.remove();
}

function electronPath(file: File): string | undefined {
  const value = (file as File & { path?: string }).path;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isImageFile(file: File): boolean {
  return IMAGE_MIME.has(file.type) || /\.(png|jpe?g|webp|gif)$/i.test(file.name);
}

export function AcpChatView({
  recordId,
  provider,
  projectPath,
  title,
  active,
  initialPrompt,
  onTitleChange,
  onSessionReady,
  onInitialPromptSubmitted
}: AcpChatPaneProps): React.JSX.Element {
  const { t } = useI18n();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const setStatus = (s: { text: string; kind?: "error" | "ok" | "warning" }) => {
    if (s.text) notifyDesktop({ text: s.text, kind: (s.kind ?? "info") as "error" | "ok" | "info" });
  };
  const [connectionStatus, setConnectionStatus] = useState("connecting");
  const [isRunning, setIsRunning] = useState(false);
  const [isConnecting, setIsConnecting] = useState(true);
  const [imageUpload, setImageUpload] = useState(false);
  const [fileUpload, setFileUpload] = useState(true);
  const [modes, setModes] = useState<ModeOption[]>([]);
  const [modeId, setModeId] = useState<string | undefined>();
  const [models, setModels] = useState<ModelsState | null>(null);
  const [configOptions, setConfigOptions] = useState<ConfigOption[]>([]);
  const [availableCommands, setAvailableCommands] = useState<AvailableCommand[]>([]);
  const [activeCommandIndex, setActiveCommandIndex] = useState(0);
  const [slashMenuDismissed, setSlashMenuDismissed] = useState(false);
  /** Selected slash command chip; free text lives in `input` after the tag. */
  const [slashTag, setSlashTag] = useState<{ name: string; inputHint?: string } | null>(null);
  const [latestPlan, setLatestPlan] = useState<PlanPreviewState | null>(null);
  const [planSheetOpen, setPlanSheetOpen] = useState(false);
  const [permission, setPermission] = useState<PermissionRequest | null>(null);
  const [userQuestion, setUserQuestion] = useState<UserQuestionRequest | null>(null);
  /** questionIndex → selected labels */
  const [questionSelections, setQuestionSelections] = useState<Record<number, string[]>>({});
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [headerTitle, setHeaderTitle] = useState(title);
  const logRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const activeCommandRef = useRef<HTMLButtonElement>(null);
  /** Tracks in-flight / completed connect for this mount so we do not double-connect. */
  const connectGenerationRef = useRef(0);
  /** True after a successful connect until unmount/error — skip reconnect on tab re-focus. */
  const sessionConnectedRef = useRef(false);
  /** Last native ACP session id that triggered a parent session-list refresh. */
  const notifiedSessionIdRef = useRef<string | undefined>(undefined);
  const pendingInitialPromptRef = useRef(initialPrompt?.trim() || "");
  const queuedPromptValueRef = useRef(initialPrompt?.trim() || "");
  const initialPromptSentRef = useRef(false);
  const onInitialPromptSubmittedRef = useRef(onInitialPromptSubmitted);
  onInitialPromptSubmittedRef.current = onInitialPromptSubmitted;

  const flushQueuedPrompt = useCallback(() => {
    const queued = pendingInitialPromptRef.current;
    if (!queued || initialPromptSentRef.current || !sessionConnectedRef.current || isRunning) return;
    initialPromptSentRef.current = true;
    pendingInitialPromptRef.current = "";
    void desktopApi().acpPrompt({ chatId: recordId, text: queued, images: [], files: [] })
      .then(() => {
        queuedPromptValueRef.current = "";
        onInitialPromptSubmittedRef.current?.();
      })
      .catch((error) => {
        initialPromptSentRef.current = false;
        pendingInitialPromptRef.current = queued;
        queuedPromptValueRef.current = "";
        setStatus({ text: errorMessage(error), kind: "error" });
      });
  }, [isRunning, recordId]);

  const scrollToBottom = useCallback((force = false) => {
    const node = logRef.current;
    if (!node) return;
    if (!force && !stickToBottom.current) return;
    if (node.clientHeight <= 0) return;
    node.scrollTop = node.scrollHeight;
  }, []);

  useLayoutEffect(() => {
    if (!active) return;
    stickToBottom.current = true;
    scrollToBottom(true);
  }, [active, scrollToBottom]);

  useLayoutEffect(() => {
    if (!active) return;
    scrollToBottom();
  }, [active, messages, scrollToBottom]);

  useLayoutEffect(() => {
    const node = logRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (active) scrollToBottom();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [active, scrollToBottom]);

  useEffect(() => {
    setHeaderTitle(title);
  }, [title]);

  // Subscribe to stream events first so connect status/init is never missed
  // (especially under React StrictMode remount races).
  useEffect(() => {
    const off = desktopApi().onAcpStream((raw) => {
      const event = raw as {
        type?: string;
        chatId?: string;
        status?: string;
        isRunning?: boolean;
        isConnecting?: boolean;
        message?: string | ChatMessage;
        messages?: ChatMessage[];
        id?: string;
        text?: string;
        toolCalls?: ToolCall[];
        streaming?: boolean;
        init?: {
          title?: string;
          modes?: ModeOption[];
          modeId?: string;
          models?: ModelsState | null;
          modelId?: string;
          configOptions?: ConfigOption[];
          availableCommands?: AvailableCommand[];
          isRunning?: boolean;
          isConnecting?: boolean;
          status?: string;
          imageUpload?: boolean;
          fileUpload?: boolean;
          embeddedContext?: boolean;
        };
        requestId?: string;
        title?: string;
        options?: Array<{ optionId: string; name: string; kind: string }>;
        questions?: UserQuestionItem[];
        path?: string;
        content?: string;
        updatedAt?: number;
      };
      if (event.chatId !== recordId) return;

      switch (event.type) {
        case "status":
          setConnectionStatus(event.status || "ready");
          setIsRunning(Boolean(event.isRunning));
          setIsConnecting(Boolean(event.isConnecting));
          break;
        case "error":
          setStatus({ text: String(event.message || "Error"), kind: "error" });
          break;
        case "init":
          if (event.init) {
            if (event.init.title) {
              setHeaderTitle(event.init.title);
              onTitleChange?.(event.init.title);
            }
            setModes(event.init.modes || []);
            setModeId(event.init.modeId);
            setModels(event.init.models || null);
            setConfigOptions(Array.isArray(event.init.configOptions) ? event.init.configOptions : []);
            setAvailableCommands(Array.isArray(event.init.availableCommands) ? event.init.availableCommands : []);
            setIsRunning(Boolean(event.init.isRunning));
            setIsConnecting(Boolean(event.init.isConnecting));
            setConnectionStatus(event.init.status || "ready");
            setImageUpload(Boolean(event.init.imageUpload));
            setFileUpload(event.init.fileUpload !== false);
          }
          break;
        case "history": {
          const history = (event.messages || []).map((message) => ({ ...message }));
          setMessages(history);
          const lastPlan = [...history].reverse().find((message) => message.role === "plan" && message.text?.trim());
          if (lastPlan) {
            setLatestPlan({
              content: lastPlan.text,
              updatedAt: lastPlan.timestamp || Date.now(),
              source: "message"
            });
          }
          break;
        }
        case "message":
          if (event.message && typeof event.message === "object") {
            const message = event.message as ChatMessage;
            setMessages((current) => {
              if (current.some((entry) => entry.id === message.id)) {
                return current.map((entry) => (entry.id === message.id ? { ...message } : entry));
              }
              return [...current, { ...message }];
            });
            if (message.role === "plan" && message.text?.trim()) {
              setLatestPlan({
                content: message.text,
                updatedAt: message.timestamp || Date.now(),
                source: "message"
              });
            }
          }
          break;
        case "messageUpdate":
          if (event.message && typeof event.message === "object") {
            const message = event.message as ChatMessage;
            setMessages((current) => current.map((entry) => (entry.id === message.id ? { ...message } : entry)));
            if (message.role === "plan" && message.text?.trim()) {
              setLatestPlan({
                content: message.text,
                updatedAt: message.timestamp || Date.now(),
                source: "message"
              });
            }
          }
          break;
        case "assistantDelta":
          if (event.id) {
            setMessages((current) => {
              const index = current.findIndex((entry) => entry.id === event.id);
              const next: ChatMessage = {
                id: event.id!,
                role: "assistant",
                text: event.text || "",
                timestamp: Date.now(),
                toolCalls: event.toolCalls,
                streaming: true
              };
              if (index >= 0) {
                const copy = [...current];
                copy[index] = { ...copy[index]!, ...next };
                return copy;
              }
              return [...current, next];
            });
          }
          break;
        case "assistantDone":
          if (event.message && typeof event.message === "object") {
            const message = event.message as ChatMessage;
            setMessages((current) => {
              const index = current.findIndex((entry) => entry.id === message.id);
              if (index >= 0) {
                const copy = [...current];
                copy[index] = { ...message, streaming: false };
                return copy;
              }
              return [...current, { ...message, streaming: false }];
            });
          }
          break;
        case "permissionRequest":
          if (event.requestId) {
            setPermission({
              requestId: event.requestId,
              title: event.title || t("desktop.workbench.acpPermissionTitle"),
              options: event.options || []
            });
          }
          break;
        case "userQuestion":
          if (event.requestId && Array.isArray(event.questions) && event.questions.length) {
            setUserQuestion({
              requestId: event.requestId,
              questions: event.questions
            });
            setQuestionSelections({});
          }
          break;
        case "planFile":
          if (typeof event.content === "string" && event.content.trim()) {
            const updatedAt = typeof event.updatedAt === "number" ? event.updatedAt : Date.now();
            const planPath = typeof event.path === "string" ? event.path : undefined;
            setLatestPlan({
              content: event.content,
              path: planPath,
              updatedAt,
              source: "file"
            });
            // Surface in the message list (not a sticky bar above the composer).
            const planMessage: ChatMessage = {
              id: planPath ? `plan-file:${planPath}` : "plan-file:latest",
              role: "plan",
              text: event.content,
              timestamp: updatedAt
            };
            setMessages((current) => {
              const index = current.findIndex((entry) => entry.id === planMessage.id || entry.role === "plan");
              if (index >= 0) {
                const copy = [...current];
                copy[index] = { ...planMessage, id: copy[index]!.id };
                return copy;
              }
              return [...current, planMessage];
            });
          }
          break;
      }
    });
    return off;
  }, [onTitleChange, recordId, t]);

  useEffect(() => {
    if (!active) return;
    const generation = ++connectGenerationRef.current;
    let cancelled = false;
    // Keep-alive: always call acp:connect (main reuses a live agent), but avoid the
    // "connecting…" flash when this pane was already successfully connected.
    const quiet = sessionConnectedRef.current;
    void (async () => {
      try {
        if (!quiet) {
          setIsConnecting(true);
          setConnectionStatus("connecting");
        }
        const result = await desktopApi().acpConnect({ chatId: recordId });
        if (!cancelled && connectGenerationRef.current === generation) {
          const acpSessionId = result.record.acpSessionId?.trim();
          if (acpSessionId && notifiedSessionIdRef.current !== acpSessionId) {
            notifiedSessionIdRef.current = acpSessionId;
            onSessionReady?.(acpSessionId);
          }
          sessionConnectedRef.current = true;
          setIsConnecting(false);
          // Stream status/init usually wins; only clear a stuck connecting/error.
          setConnectionStatus((status) =>
            status === "connecting" || status === "error" ? "ready" : status
          );
          flushQueuedPrompt();
        }
      } catch (error) {
        if (!cancelled && connectGenerationRef.current === generation) {
          sessionConnectedRef.current = false;
          setStatus({ text: errorMessage(error), kind: "error" });
          setConnectionStatus("error");
          setIsConnecting(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, flushQueuedPrompt, onSessionReady, recordId]);

  useEffect(() => {
    const next = initialPrompt?.trim() || "";
    if (!active || !next || queuedPromptValueRef.current === next) return;
    queuedPromptValueRef.current = next;
    pendingInitialPromptRef.current = next;
    initialPromptSentRef.current = false;
    flushQueuedPrompt();
  }, [active, flushQueuedPrompt, initialPrompt]);

  useEffect(() => {
    return () => {
      sessionConnectedRef.current = false;
      void desktopApi().acpDisconnect({ chatId: recordId });
      connectGenerationRef.current += 1;
    };
  }, [recordId]);

  const stageFiles = useCallback(
    async (list: FileList | File[] | null) => {
      if (!list || !("length" in list) || !list.length) return;
      const files = Array.from(list as ArrayLike<File>);
      const next: PendingAttachment[] = [];
      let imageCount = pending.filter((item) => item.kind === "image").length;
      let fileCount = pending.filter((item) => item.kind === "file").length;

      for (const file of files) {
        if (isImageFile(file) && (imageUpload || fileUpload)) {
          if (imageUpload) {
            if (imageCount >= MAX_IMAGES) {
              setStatus({ text: t("desktop.workbench.acpTooManyImages", MAX_IMAGES), kind: "error" });
              continue;
            }
            if (file.size > MAX_IMAGE_BYTES) {
              setStatus({ text: t("desktop.workbench.acpImageTooLarge", file.name), kind: "error" });
              continue;
            }
            if (file.type && !IMAGE_MIME.has(file.type)) {
              setStatus({ text: t("desktop.workbench.acpUnsupportedImage"), kind: "error" });
              continue;
            }
            const dataUrl = await readFileAsDataUrl(file);
            const data = dataUrl.split(",")[1] || "";
            next.push({
              kind: "image",
              id: newId(),
              mimeType: file.type || "image/png",
              fileName: file.name,
              data,
              previewUrl: dataUrl
            });
            imageCount += 1;
            continue;
          }
        }

        if (!fileUpload) {
          setStatus({ text: t("desktop.workbench.acpFileUploadUnavailable"), kind: "error" });
          continue;
        }
        if (fileCount >= MAX_FILES) {
          setStatus({ text: t("desktop.workbench.acpTooManyFiles", MAX_FILES), kind: "error" });
          continue;
        }
        if (file.size > MAX_FILE_BYTES) {
          setStatus({ text: t("desktop.workbench.acpFileTooLarge", file.name), kind: "error" });
          continue;
        }

        const absolutePath = electronPath(file);
        let data: string | undefined;
        // Prefer absolute path (resource_link). If missing, embed base64 for small-ish files.
        if (!absolutePath) {
          if (file.size > 2 * 1024 * 1024) {
            setStatus({ text: t("desktop.workbench.acpFileNeedPath", file.name), kind: "error" });
            continue;
          }
          const dataUrl = await readFileAsDataUrl(file);
          data = dataUrl.split(",")[1] || "";
        }
        next.push({
          kind: "file",
          id: newId(),
          mimeType: file.type || "application/octet-stream",
          fileName: file.name,
          absolutePath,
          data,
          sizeBytes: file.size
        });
        fileCount += 1;
      }

      if (next.length) {
        setPending((current) => [...current, ...next]);
        setStatus({ text: "" });
      }
    },
    [fileUpload, imageUpload, pending, t]
  );

  const composePromptText = useCallback(
    (textOverride?: string) => {
      if (typeof textOverride === "string") return textOverride.trim();
      const suffix = input.trim();
      if (slashTag) {
        return suffix ? `/${slashTag.name} ${suffix}` : `/${slashTag.name}`;
      }
      return suffix;
    },
    [input, slashTag]
  );

  const send = async (textOverride?: string) => {
    const text = composePromptText(textOverride);
    if ((!text && !pending.length) || isRunning || isConnecting) return;
    const images = pending
      .filter((item): item is PendingImage => item.kind === "image")
      .map(({ mimeType, fileName, data }) => ({ mimeType, fileName, data }));
    const files = pending
      .filter((item): item is PendingFile => item.kind === "file")
      .map(({ mimeType, fileName, absolutePath, data, sizeBytes }) => ({
        mimeType,
        fileName,
        absolutePath,
        data,
        sizeBytes
      }));
    setInput("");
    setSlashTag(null);
    setPending([]);
    setStatus({ text: "" });
    try {
      await desktopApi().acpPrompt({ chatId: recordId, text, images, files });
    } catch (error) {
      setStatus({ text: errorMessage(error), kind: "error" });
    }
  };

  // Slash menu only while composing a leading `/…` token (no chip yet).
  const slashQuery = !slashTag ? input.match(/^\/([^\s]*)$/)?.[1] : undefined;
  const filteredCommands = useMemo(() => {
    if (slashQuery === undefined) return [];
    const query = slashQuery.toLocaleLowerCase();
    return availableCommands.filter((command) => command.name.toLocaleLowerCase().startsWith(query));
  }, [availableCommands, slashQuery]);
  const slashMenuOpen = !slashMenuDismissed && filteredCommands.length > 0;
  const activeCommand = filteredCommands[activeCommandIndex] ?? filteredCommands[0];

  useEffect(() => {
    setActiveCommandIndex(0);
  }, [input, availableCommands, slashTag]);

  useEffect(() => {
    const activeElement = activeCommandRef.current;
    if (slashMenuOpen && typeof activeElement?.scrollIntoView === "function") {
      activeElement.scrollIntoView({ block: "nearest" });
    }
  }, [activeCommandIndex, slashMenuOpen]);

  const selectCommand = (command: AvailableCommand) => {
    // Always insert as a chip so the user can append args; Enter sends.
    setSlashMenuDismissed(true);
    setSlashTag({
      name: command.name,
      ...(command.inputHint ? { inputHint: command.inputHint } : {})
    });
    setInput("");
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(0, 0);
    });
  };

  const clearSlashTag = () => {
    setSlashTag(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const cancel = async () => {
    try {
      await desktopApi().acpCancel({ chatId: recordId });
    } catch (error) {
      setStatus({ text: errorMessage(error), kind: "error" });
    }
  };

  const onModeChange = async (next: string) => {
    const previous = modeId;
    setModeId(next);
    try {
      // Prefer native session mode when modes list came from modes API.
      if (modes.some((mode) => mode.id === next)) {
        await desktopApi().acpSetMode({ chatId: recordId, modeId: next });
        return;
      }
      const modeConfig = configOptions.find(
        (option) => option.type === "select" && option.category === "mode"
      );
      if (modeConfig) {
        await desktopApi().acpSetConfigOption({
          chatId: recordId,
          configId: modeConfig.id,
          value: next
        });
      }
    } catch (error) {
      setModeId(previous);
      setStatus({ text: errorMessage(error), kind: "error" });
    }
  };

  const onConfigSelectChange = async (configId: string, value: string) => {
    const previous = configOptions;
    setConfigOptions((current) =>
      current.map((option) =>
        option.id === configId && option.type === "select" ? { ...option, currentValue: value } : option
      )
    );
    if (models && configOptions.some((option) => option.id === configId && option.category === "model")) {
      setModels({ ...models, currentModelId: value });
    }
    try {
      await desktopApi().acpSetConfigOption({ chatId: recordId, configId, value });
    } catch (error) {
      setConfigOptions(previous);
      setStatus({ text: errorMessage(error), kind: "error" });
    }
  };

  const onLegacyModelChange = async (modelId: string) => {
    if (!models) return;
    const previous = models;
    setModels({ ...models, currentModelId: modelId });
    // Prefer config option if present for model.
    const modelConfig = configOptions.find(
      (option) => option.type === "select" && option.category === "model"
    );
    if (modelConfig) {
      await onConfigSelectChange(modelConfig.id, modelId);
      return;
    }
    // No dedicated setModel RPC in older agents — keep UI selection only if config missing.
    try {
      // Some agents expose models as modes historically; try setMode as last resort.
      await desktopApi().acpSetMode({ chatId: recordId, modeId: modelId });
    } catch (error) {
      setModels(previous);
      setStatus({ text: errorMessage(error), kind: "error" });
    }
  };

  const modeSelect = useMemo(() => {
    if (modes.length) {
      return {
        kind: "native-mode" as const,
        value: modeId || modes[0]?.id || "",
        options: modes.map((mode) => ({ value: mode.id, name: mode.name }))
      };
    }
    const config = configOptions.find(
      (option): option is Extract<ConfigOption, { type: "select" }> =>
        option.type === "select" && option.category === "mode"
    );
    if (!config) return null;
    return {
      kind: "config" as const,
      configId: config.id,
      value: config.currentValue,
      options: flattenSelectOptions(config.options)
    };
  }, [configOptions, modeId, modes]);

  const cycleMode = useCallback(() => {
    if (!modeSelect || modeSelect.options.length < 2 || isRunning || isConnecting) return;
    const options = modeSelect.options;
    const currentIndex = Math.max(
      0,
      options.findIndex((option) => option.value === modeSelect.value)
    );
    const next = options[(currentIndex + 1) % options.length]!;
    const label = next.name || next.value;
    if (modeSelect.kind === "native-mode") {
      const previous = modeId;
      setModeId(next.value);
      void desktopApi()
        .acpSetMode({ chatId: recordId, modeId: next.value })
        .catch((error: unknown) => {
          setModeId(previous);
          setStatus({ text: errorMessage(error), kind: "error" });
        });
    } else {
      void onConfigSelectChange(modeSelect.configId, next.value);
    }
    setStatus({ text: t("desktop.workbench.acpModeSwitched", label), kind: "ok" });
  }, [isConnecting, isRunning, modeId, modeSelect, onConfigSelectChange, recordId, t]);

  // Grok-style Shift+Tab: cycle agent session modes when the ACP pane is active.
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const isTab = event.key === "Tab" || event.code === "Tab";
      if (!event.shiftKey || !isTab) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (!modeSelect || modeSelect.options.length < 2) return;
      if (isRunning || isConnecting) return;
      event.preventDefault();
      event.stopPropagation();
      cycleMode();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [active, cycleMode, isConnecting, isRunning, modeSelect]);

  const openPlanPreview = useCallback((plan?: PlanPreviewState | null) => {
    const target = plan
      ? {
          ...plan,
          // Keep disk path from the latest file write when opening a plan bubble.
          path: plan.path || latestPlan?.path
        }
      : latestPlan;
    if (!target?.content) return;
    setLatestPlan(target);
    setPlanSheetOpen(true);
  }, [latestPlan]);

  const openPlanInEditor = useCallback(async () => {
    if (!latestPlan?.path) return;
    try {
      await desktopApi().acpOpenPath({ path: latestPlan.path });
    } catch (error) {
      setStatus({ text: errorMessage(error), kind: "error" });
    }
  }, [latestPlan?.path]);

  const modelSelect = useMemo(() => {
    const config = configOptions.find(
      (option): option is Extract<ConfigOption, { type: "select" }> =>
        option.type === "select" && option.category === "model"
    );
    if (config) {
      return {
        kind: "config" as const,
        configId: config.id,
        value: config.currentValue,
        options: flattenSelectOptions(config.options)
      };
    }
    if (models?.availableModels?.length) {
      return {
        kind: "legacy-model" as const,
        value: models.currentModelId,
        options: models.availableModels.map((entry) => ({
          value: entry.modelId,
          name: entry.name
        }))
      };
    }
    return null;
  }, [configOptions, models]);

  const thinkingSelect = useMemo(() => {
    const config = configOptions.find(
      (option): option is Extract<ConfigOption, { type: "select" }> =>
        option.type === "select" && option.category === "thought_level"
    );
    if (!config) return null;
    return {
      configId: config.id,
      value: config.currentValue,
      options: flattenSelectOptions(config.options)
    };
  }, [configOptions]);

  /** Codex (and similar): category collaboration_mode — Default / Plan. */
  const collaborationSelect = useMemo(() => {
    const config = configOptions.find(
      (option): option is Extract<ConfigOption, { type: "select" }> =>
        option.type === "select" && option.category === "collaboration_mode"
    );
    if (!config) return null;
    return {
      configId: config.id,
      value: config.currentValue,
      options: flattenSelectOptions(config.options)
    };
  }, [configOptions]);

  const respondPermission = async (optionId?: string, cancelled = false) => {
    if (!permission) return;
    const requestId = permission.requestId;
    setPermission(null);
    try {
      await desktopApi().acpRespondPermission({ requestId, optionId, cancelled });
    } catch (error) {
      setStatus({ text: errorMessage(error), kind: "error" });
    }
  };

  const toggleQuestionOption = (questionIndex: number, label: string, multiSelect: boolean) => {
    setQuestionSelections((current) => {
      const prev = current[questionIndex] || [];
      if (!multiSelect) {
        return { ...current, [questionIndex]: [label] };
      }
      const exists = prev.includes(label);
      const next = exists ? prev.filter((entry) => entry !== label) : [...prev, label];
      return { ...current, [questionIndex]: next };
    });
  };

  const respondQuestion = async (cancelled = false) => {
    if (!userQuestion) return;
    const requestId = userQuestion.requestId;
    const questions = userQuestion.questions;
    const answers: Record<string, string> = {};
    if (!cancelled) {
      questions.forEach((item, index) => {
        const labels = questionSelections[index] || [];
        if (!labels.length) return;
        answers[item.question] = labels.join(", ");
      });
    }
    // Single question + single-select can submit with one pick only if we have answers.
    if (!cancelled && !Object.keys(answers).length) return;
    setUserQuestion(null);
    setQuestionSelections({});
    try {
      await desktopApi().acpRespondQuestion({
        requestId,
        cancelled,
        answers: cancelled ? undefined : answers
      });
    } catch (error) {
      setStatus({ text: errorMessage(error), kind: "error" });
    }
  };

  const canSubmitQuestion = useMemo(() => {
    if (!userQuestion) return false;
    return userQuestion.questions.every((item, index) => {
      const selected = questionSelections[index] || [];
      return selected.length > 0;
    });
  }, [questionSelections, userQuestion]);

  useEffect(() => {
    if (!active) return;
    const onPaste = (event: ClipboardEvent) => {
      if (!imageUpload && !fileUpload) return;
      const items = [...(event.clipboardData?.items ?? [])];
      const imageItems = items.filter((item) => item.type.startsWith("image/"));
      if (!imageItems.length) return;
      event.preventDefault();
      const files: File[] = [];
      for (const item of imageItems) {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
      void stageFiles(files);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [active, fileUpload, imageUpload, stageFiles]);

  const statusLabel = useMemo(() => {
    if (isConnecting) return t("desktop.workbench.acpConnecting");
    if (isRunning) return t("desktop.workbench.acpThinking");
    if (connectionStatus === "error") return t("desktop.workbench.acpError");
    return t("desktop.workbench.acpReady");
  }, [connectionStatus, isConnecting, isRunning, t]);

  const attachEnabled = (fileUpload || imageUpload) && !isRunning && !isConnecting;
  const placeholder = slashTag
    ? slashTag.inputHint || t("desktop.workbench.acpSlashArgPlaceholder")
    : imageUpload || fileUpload
      ? t("desktop.workbench.acpInputPlaceholderAttach")
      : t("desktop.workbench.acpInputPlaceholder");
  const hasStreamingMessage = messages.some((message) => message.streaming);
  const showTypingIndicator = isRunning && !hasStreamingMessage;
  const canSend = Boolean(composePromptText() || pending.length) && !isRunning && !isConnecting;

  return (
    <>
    <div
      className={`wb-acp-chat${dragOver ? " is-dragover" : ""}`}
      hidden={!active}
      onDragEnter={(event) => {
        if (!attachEnabled) return;
        event.preventDefault();
        setDragOver(true);
      }}
      onDragOver={(event) => {
        if (!attachEnabled) return;
        event.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node)) return;
        setDragOver(false);
      }}
      onDrop={(event) => {
        if (!attachEnabled) return;
        event.preventDefault();
        setDragOver(false);
        void stageFiles(event.dataTransfer?.files ?? null);
      }}
    >
      <div className="wb-acp-header">
        <div className="wb-acp-header-main">
          <span className={`wb-acp-status-dot ${connectionStatus}`} aria-hidden="true" />
          <div className="wb-acp-header-text">
            <div className="wb-acp-title">
              <ProviderIcon provider={provider} size={15} className="wb-acp-title-icon" aria-hidden="true" />
              <span>{headerTitle || t("desktop.workbench.acpChat")}</span>
            </div>
            <div className="wb-acp-meta muted">
              {providerLabel(provider, t)} · {statusLabel}
              {projectPath ? ` · ${projectPath}` : ""}
            </div>
          </div>
        </div>
      </div>

      <div
        className="wb-acp-log chat-log"
        ref={logRef}
        onScroll={(event) => {
          const node = event.currentTarget;
          if (node.clientHeight <= 0) return;
          stickToBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
        }}
      >
        {!messages.length ? (
          <div className="chat-empty-state">
            <p className="chat-empty-title">{t("desktop.workbench.acpEmptyTitle")}</p>
            <p className="chat-empty-hint">{t("desktop.workbench.acpEmptyHint")}</p>
          </div>
        ) : (
          messages.map((message, index) => {
            const outbound = isOutboundRole(message.role);
            const prev = index > 0 ? messages[index - 1] : undefined;
            const next = index < messages.length - 1 ? messages[index + 1] : undefined;
            const currentDay = dayKey(message.timestamp);
            const prevDay = prev ? dayKey(prev.timestamp) : "";
            const showDay = Boolean(currentDay) && currentDay !== prevDay;
            const prevSameSide = Boolean(prev) && isOutboundRole(prev!.role) === outbound && dayKey(prev!.timestamp) === currentDay;
            const nextSameSide = Boolean(next) && isOutboundRole(next!.role) === outbound && dayKey(next!.timestamp) === currentDay;
            const showSender = !outbound && !prevSameSide;
            const clusterClass = [
              prevSameSide ? "is-cluster-continue" : "is-cluster-start",
              nextSameSide ? "is-cluster-before" : "is-cluster-end"
            ].join(" ");
            const timeLabel = formatMessageTime(message.timestamp);
            const canCopy = !outbound && !message.streaming && Boolean(message.text?.trim());
            return (
              <div key={message.id} className="wb-acp-message-block">
                {showDay ? (
                  <div className="wb-acp-day-separator" role="separator">
                    <span>{formatDaySeparator(message.timestamp)}</span>
                  </div>
                ) : null}
                <div
                  className={`chat-message ${outbound ? "chat-message-out" : "chat-message-in"} ${clusterClass}`}
                >
                  <div
                    className={`chat-bubble ${outbound ? "user" : "assistant"}${message.streaming ? " streaming" : ""}`}
                  >
                    {showSender ? (
                      <div className="chat-sender">
                        <ProviderIcon provider={provider} size={14} aria-hidden="true" />
                        {providerLabel(provider, t)}
                      </div>
                    ) : null}
                    <div className="chat-body">
                      {message.role === "plan" ? (
                        <div className="wb-acp-plan-inline">
                          <div className="wb-acp-plan-inline-head">
                            <ThemeIcon name="file-text" size={14} aria-hidden="true" />
                            <strong>{t("desktop.workbench.acpPlanTitle")}</strong>
                          </div>
                          <p className="wb-acp-plan-inline-snippet">
                            {message.text.split("\n").find((line) => line.trim())?.slice(0, 160) ||
                              t("desktop.workbench.acpPlanEmpty")}
                          </p>
                          <button
                            type="button"
                            className="ghost-btn wb-acp-plan-preview-btn"
                            onClick={() =>
                              openPlanPreview({
                                content: message.text,
                                updatedAt: message.timestamp || Date.now(),
                                source: "message"
                              })
                            }
                          >
                            {t("desktop.workbench.acpPlanPreview")}
                          </button>
                        </div>
                      ) : outbound ? (
                        <div className="chat-user-text">{message.text}</div>
                      ) : message.text ? (
                        <div
                          className="chat-body-text markdown-body"
                          dangerouslySetInnerHTML={{
                            __html: renderMarkdown(message.text)
                          }}
                        />
                      ) : null}
                      {message.streaming ? (
                        <JumpingDots label={t("desktop.workbench.acpThinking")} />
                      ) : null}
                    </div>
                    {message.images?.length || message.files?.length ? (
                      <div className="wb-acp-message-attachments">
                        {message.files?.map((file) => (
                          <div className="wb-acp-file-chip" key={file.id} title={file.absolutePath || file.fileName}>
                            <ThemeIcon name="file-text" size={13} aria-hidden="true" />
                            <span className="wb-acp-file-name">{file.fileName}</span>
                            {file.sizeBytes != null ? <span className="wb-acp-file-size">{formatBytes(file.sizeBytes)}</span> : null}
                          </div>
                        ))}
                        {message.images?.map((image) => (
                          <div className="wb-acp-file-chip is-image" key={image.id} title={image.fileName}>
                            <span className="wb-acp-file-name">{image.fileName}</span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {message.toolCalls?.length ? (
                      <div className="wb-acp-tools">
                        {message.toolCalls.map((tool) => (
                          <AcpToolChip key={tool.toolCallId} tool={tool} t={t} />
                        ))}
                      </div>
                    ) : null}
                    {timeLabel || canCopy ? (
                      <div className="chat-footer">
                        {canCopy ? (
                          <button
                            type="button"
                            className="chat-copy-btn"
                            onClick={() => void copyText(message.text)}
                          >
                            <ThemeIcon name="copy" size={12} aria-hidden="true" />
                            {t("desktop.common.copy")}
                          </button>
                        ) : null}
                        {timeLabel ? <span className="chat-footer-meta">{timeLabel}</span> : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })
        )}
        {showTypingIndicator ? (
          <div className="wb-acp-message-block">
            <div className="chat-message chat-message-in is-cluster-start is-cluster-end">
              <div className="chat-bubble assistant streaming">
                <div className="chat-sender">
                  <ProviderIcon provider={provider} size={14} aria-hidden="true" />
                  {providerLabel(provider, t)}
                </div>
                <div className="chat-body">
                  <JumpingDots label={t("desktop.workbench.acpThinking")} />
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {permission ? (
        <div className="agent-tool-approval-bar wb-acp-permission">
          <div className="agent-tool-approval-copy">
            <strong>{t("desktop.workbench.acpPermissionTitle")}</strong>
            <span>{permission.title}</span>
          </div>
          <div className="agent-tool-approval-actions">
            {permission.options.map((option) => (
              <button
                type="button"
                key={option.optionId}
                className="ghost-btn"
                onClick={() => void respondPermission(option.optionId)}
              >
                {option.name}
              </button>
            ))}
            <button type="button" className="ghost-btn" onClick={() => void respondPermission(undefined, true)}>
              {t("desktop.common.cancel")}
            </button>
          </div>
        </div>
      ) : null}

      {userQuestion ? (
        <div className="wb-acp-question-card" role="dialog" aria-label={t("desktop.workbench.acpQuestionTitle")}>
          <div className="wb-acp-question-head">
            <strong>{t("desktop.workbench.acpQuestionTitle")}</strong>
          </div>
          <div className="wb-acp-question-list">
            {userQuestion.questions.map((item, questionIndex) => {
              const selected = questionSelections[questionIndex] || [];
              const singleFast =
                userQuestion.questions.length === 1 && !item.multiSelect && item.options.length > 0;
              return (
                <div className="wb-acp-question-item" key={`${questionIndex}-${item.question}`}>
                  <div className="wb-acp-question-text">{item.question}</div>
                  <div className="wb-acp-question-options">
                    {item.options.map((option) => {
                      const isSelected = selected.includes(option.label);
                      return (
                        <button
                          type="button"
                          key={option.label}
                          className={`wb-acp-question-option${isSelected ? " is-selected" : ""}`}
                          title={option.description || option.preview || option.label}
                          onClick={() => {
                            if (singleFast) {
                              setQuestionSelections({ [questionIndex]: [option.label] });
                              // Defer so state flush isn't required — answer immediately.
                              void (async () => {
                                const requestId = userQuestion.requestId;
                                setUserQuestion(null);
                                setQuestionSelections({});
                                try {
                                  await desktopApi().acpRespondQuestion({
                                    requestId,
                                    answers: { [item.question]: option.label }
                                  });
                                } catch (error) {
                                  setStatus({ text: errorMessage(error), kind: "error" });
                                }
                              })();
                              return;
                            }
                            toggleQuestionOption(questionIndex, option.label, Boolean(item.multiSelect));
                          }}
                        >
                          <span className="wb-acp-question-option-label">{option.label}</span>
                          {option.description ? (
                            <span className="wb-acp-question-option-desc">{option.description}</span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          {userQuestion.questions.length > 1 ||
          userQuestion.questions.some((item) => item.multiSelect) ? (
            <div className="wb-acp-question-actions">
              <button
                type="button"
                className="ghost-btn"
                onClick={() => void respondQuestion(true)}
              >
                {t("desktop.workbench.acpQuestionSkip")}
              </button>
              <button
                type="button"
                className="ghost-btn"
                disabled={!canSubmitQuestion}
                onClick={() => void respondQuestion(false)}
              >
                {t("desktop.workbench.acpQuestionSubmit")}
              </button>
            </div>
          ) : (
            <div className="wb-acp-question-actions">
              <button type="button" className="ghost-btn" onClick={() => void respondQuestion(true)}>
                {t("desktop.workbench.acpQuestionSkip")}
              </button>
            </div>
          )}
        </div>
      ) : null}

      {pending.length ? (
        <div className="wb-acp-pending-images">
          {pending.map((item) =>
            item.kind === "image" ? (
              <div className="wb-acp-pending-image" key={item.id}>
                <img src={item.previewUrl} alt={item.fileName} />
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={t("desktop.common.close")}
                  onClick={() => setPending((current) => current.filter((entry) => entry.id !== item.id))}
                >
                  <ThemeIcon name="close" size={12} />
                </button>
              </div>
            ) : (
              <div className="wb-acp-pending-file" key={item.id} title={item.absolutePath || item.fileName}>
                <ThemeIcon name="file-text" size={14} aria-hidden="true" />
                <div className="wb-acp-pending-file-meta">
                  <span className="wb-acp-file-name">{item.fileName}</span>
                  <span className="wb-acp-file-size muted">{formatBytes(item.sizeBytes)}</span>
                </div>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={t("desktop.common.close")}
                  onClick={() => setPending((current) => current.filter((entry) => entry.id !== item.id))}
                >
                  <ThemeIcon name="close" size={12} />
                </button>
              </div>
            )
          )}
        </div>
      ) : null}

      <div className="chat-compose wb-acp-compose">
        <div className="chat-compose-frame">
          <div className="chat-compose-field">
            <div className={`wb-acp-compose-input${slashTag ? " has-slash-tag" : ""}`}>
              {slashTag ? (
                <span className="wb-acp-slash-tag" title={slashTag.inputHint || `/${slashTag.name}`}>
                  <span className="wb-acp-slash-tag-name">/{slashTag.name}</span>
                  <button
                    type="button"
                    className="wb-acp-slash-tag-clear"
                    aria-label={t("desktop.common.close")}
                    disabled={isRunning || isConnecting}
                    onClick={clearSlashTag}
                  >
                    <ThemeIcon name="close" size={11} aria-hidden="true" />
                  </button>
                </span>
              ) : null}
              <textarea
                ref={inputRef}
                rows={1}
                value={input}
                disabled={isRunning || isConnecting}
                placeholder={placeholder}
                aria-autocomplete="list"
                aria-controls={slashMenuOpen ? "wb-acp-command-list" : undefined}
                aria-expanded={slashMenuOpen}
                aria-activedescendant={slashMenuOpen && activeCommand ? `wb-acp-command-${activeCommand.name}` : undefined}
                onChange={(event) => {
                  setInput(event.target.value);
                  setSlashMenuDismissed(false);
                }}
                onKeyDown={(event) => {
                  if (slashMenuOpen) {
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      setActiveCommandIndex((current) => (current + 1) % filteredCommands.length);
                      return;
                    }
                    if (event.key === "ArrowUp") {
                      event.preventDefault();
                      setActiveCommandIndex((current) => (current - 1 + filteredCommands.length) % filteredCommands.length);
                      return;
                    }
                    if ((event.key === "Enter" || event.key === "Tab") && activeCommand) {
                      event.preventDefault();
                      selectCommand(activeCommand);
                      return;
                    }
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setSlashMenuDismissed(true);
                      return;
                    }
                  }
                  if (
                    event.key === "Backspace" &&
                    slashTag &&
                    !input &&
                    !event.metaKey &&
                    !event.ctrlKey &&
                    !event.altKey
                  ) {
                    event.preventDefault();
                    clearSlashTag();
                    return;
                  }
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void send();
                  }
                }}
              />
            </div>
            {slashMenuOpen ? (
              <div
                id="wb-acp-command-list"
                className="wb-acp-command-menu"
                role="listbox"
                aria-label={t("desktop.workbench.acpSlashCommands")}
              >
                {filteredCommands.map((command, index) => (
                  <button
                    key={command.name}
                    ref={index === activeCommandIndex ? activeCommandRef : undefined}
                    id={`wb-acp-command-${command.name}`}
                    type="button"
                    className={`wb-acp-command${index === activeCommandIndex ? " is-active" : ""}`}
                    role="option"
                    aria-selected={index === activeCommandIndex}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => selectCommand(command)}
                  >
                    <span className="wb-acp-command-name">/{command.name}</span>
                    {command.description ? <span className="wb-acp-command-description">{command.description}</span> : null}
                    {command.inputHint ? <span className="wb-acp-command-input">{command.inputHint}</span> : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="chat-compose-toolbar">
            {fileUpload || imageUpload ? (
              <>
                <button
                  type="button"
                  className="chat-tools-toggle"
                  title={t("desktop.workbench.acpAttachFile")}
                  aria-label={t("desktop.workbench.acpAttachFile")}
                  disabled={!attachEnabled}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <ThemeIcon name="paperclip" size={16} />
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  hidden
                  onChange={(event) => {
                    void stageFiles(event.target.files);
                    event.target.value = "";
                  }}
                />
              </>
            ) : null}
            {modelSelect ? (
              <select
                className="wb-acp-toolbar-select"
                value={modelSelect.value}
                disabled={isRunning || isConnecting}
                aria-label={t("desktop.workbench.acpModel")}
                title={t("desktop.workbench.acpModel")}
                onChange={(event) => {
                  const value = event.target.value;
                  if (modelSelect.kind === "config") void onConfigSelectChange(modelSelect.configId, value);
                  else void onLegacyModelChange(value);
                }}
              >
                {modelSelect.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.name}
                  </option>
                ))}
              </select>
            ) : null}
            {modeSelect ? (
              <select
                className="wb-acp-toolbar-select"
                value={modeSelect.value}
                disabled={isRunning || isConnecting}
                aria-label={t("desktop.workbench.acpMode")}
                title={t("desktop.workbench.acpMode")}
                onChange={(event) => {
                  const value = event.target.value;
                  if (modeSelect.kind === "native-mode") void onModeChange(value);
                  else void onConfigSelectChange(modeSelect.configId, value);
                }}
              >
                {modeSelect.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.name}
                  </option>
                ))}
              </select>
            ) : null}
            {collaborationSelect ? (
              <select
                className="wb-acp-toolbar-select"
                value={collaborationSelect.value}
                disabled={isRunning || isConnecting}
                aria-label={t("desktop.workbench.acpCollaboration")}
                title={t("desktop.workbench.acpCollaboration")}
                onChange={(event) =>
                  void onConfigSelectChange(collaborationSelect.configId, event.target.value)
                }
              >
                {collaborationSelect.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.name}
                  </option>
                ))}
              </select>
            ) : null}
            {thinkingSelect ? (
              <select
                className="wb-acp-toolbar-select"
                value={thinkingSelect.value}
                disabled={isRunning || isConnecting}
                aria-label={t("desktop.workbench.acpEffort")}
                title={t("desktop.workbench.acpEffort")}
                onChange={(event) => void onConfigSelectChange(thinkingSelect.configId, event.target.value)}
              >
                {thinkingSelect.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.name}
                  </option>
                ))}
              </select>
            ) : null}
            <span className="chat-compose-toolbar-spacer" />
            {isRunning ? (
              <button type="button" className="chat-send-btn" aria-label={t("desktop.common.cancel")} onClick={() => void cancel()}>
                <ThemeIcon name="square" size={15} />
              </button>
            ) : (
              <button
                type="button"
                className="chat-send-btn"
                aria-label={t("desktop.common.send")}
                disabled={!canSend}
                onClick={() => void send()}
              >
                <ThemeIcon name="send" size={18} />
              </button>
            )}
          </div>
        </div>
      </div>
      {dragOver ? <div className="wb-acp-drop-hint">{t("desktop.workbench.acpDropHint")}</div> : null}
    </div>
    <Sheet
      open={planSheetOpen && Boolean(latestPlan)}
      title={t("desktop.workbench.acpPlanPreviewTitle")}
      wide
      onClose={() => setPlanSheetOpen(false)}
      bodyClassName="wb-acp-plan-sheet-body"
      actions={
        latestPlan?.path ? (
          <button type="button" className="ghost-btn" onClick={() => void openPlanInEditor()}>
            <ThemeIcon name="external-link" size={14} aria-hidden="true" />
            {t("desktop.workbench.acpPlanOpen")}
          </button>
        ) : null
      }
    >
      {latestPlan?.path ? (
        <p className="wb-acp-plan-sheet-path muted" title={latestPlan.path}>
          {latestPlan.path}
        </p>
      ) : null}
      <div
        className="markdown-body wb-acp-plan-markdown"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(latestPlan?.content || "") }}
      />
    </Sheet>
    </>
  );
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function flattenSelectOptions(
  options: Array<ConfigSelectOption | ConfigSelectGroup>
): ConfigSelectOption[] {
  const out: ConfigSelectOption[] = [];
  for (const option of options) {
    if ("value" in option) {
      out.push({ value: option.value, name: option.name });
      continue;
    }
    for (const child of option.options || []) {
      out.push({ value: child.value, name: child.name });
    }
  }
  return out;
}
