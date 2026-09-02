import type { JSX } from "react";
import {
  Activity, Archive, ArrowDown, ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUp, ArrowUpToLine, AtSign, Bell, Bot, Check,
  ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Circle, Clipboard, Cloud, Command,
  Copy, CornerDownRight, Download, ExternalLink, Eye, EyeOff, File, FileArchive, FileAudio,
  FileCode2, FileCog, FileDiff, FileImage, FileJson, FilePlus2,
  FileSpreadsheet, FileTerminal, FileText, FileVideo, Folder, FolderOpen,
  FolderTree, GitBranch, Globe, GripVertical, History, LoaderCircle,
  MessageSquare, MessageSquarePlus, MessageSquareWarning, PanelRight, Paperclip, Pencil, Pin, Play, Plus,
  Quote, RefreshCw, Save, Search, Send, Settings, ShieldCheck, Sparkles, Square,
  SquareKanban, TerminalSquare, Trash2, Undo2, Upload, User, Waypoints, Wrench, X, Zap,
  type LucideIcon,
  type LucideProps
} from "lucide-react";

/** Semantic icon registry. A missing built-in icon is a compile-time error. */
const ICONS = {
  activity: Activity, archive: Archive, "arrow-down": ArrowDown, "arrow-down-to-line": ArrowDownToLine,
  "arrow-left": ArrowLeft, "arrow-right": ArrowRight,
  "arrow-up": ArrowUp, "arrow-up-to-line": ArrowUpToLine, "at-sign": AtSign, bell: Bell, bot: Bot, check: Check,
  "chevron-down": ChevronDown, "chevron-left": ChevronLeft, "chevron-right": ChevronRight, "chevron-up": ChevronUp,
  circle: Circle, clipboard: Clipboard, cloud: Cloud, command: Command, copy: Copy,
  download: Download, "external-link": ExternalLink, eye: Eye, "eye-off": EyeOff,
  file: File, "file-archive": FileArchive, "file-audio": FileAudio, "file-code": FileCode2,
  "file-cog": FileCog, "file-diff": FileDiff, "file-image": FileImage, "file-json": FileJson,
  "file-plus": FilePlus2, "file-spreadsheet": FileSpreadsheet, "file-terminal": FileTerminal,
  "file-text": FileText, "file-video": FileVideo, folder: Folder, "folder-open": FolderOpen,
  "folder-tree": FolderTree, "git-branch": GitBranch, globe: Globe, "grip-vertical": GripVertical,
  history: History, loader: LoaderCircle,
  "message-square": MessageSquare, "message-square-plus": MessageSquarePlus, "message-square-warning": MessageSquareWarning,
  "panel-right": PanelRight, paperclip: Paperclip, pencil: Pencil, pin: Pin, play: Play, plus: Plus,
  quote: Quote, refresh: RefreshCw, save: Save, search: Search, send: Send, settings: Settings,
  "shield-check": ShieldCheck, sparkles: Sparkles, square: Square, "square-kanban": SquareKanban,
  terminal: TerminalSquare,
  trash: Trash2, undo: Undo2, upload: Upload, user: User, waypoints: Waypoints, wrench: Wrench, close: X,
  zap: Zap, "corner-down-right": CornerDownRight
} as const satisfies Record<string, LucideIcon>;

export type ThemeIconName = keyof typeof ICONS;
export type ThemeIconProps = LucideProps & { name: ThemeIconName };

/**
 * The one icon entry point for Desktop. Visual themes style this stable semantic
 * SVG through `data-theme-icon`; business views never choose another theme's icon.
 */
export function ThemeIcon({ name, ...props }: ThemeIconProps): JSX.Element {
  const Icon = ICONS[name];
  return <Icon data-theme-icon={name} {...props} />;
}
