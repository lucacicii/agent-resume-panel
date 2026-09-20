import type { JSX } from "react";
import {
  Activity, AppWindow, Archive, ArrowDown, ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUp, ArrowUpToLine, AtSign, Bell, Bot, Check,
  ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Circle, Clipboard, Cloud, Command,
  Copy, CornerDownRight, Download, Ellipsis, ExternalLink, Eye, EyeOff, File, FileArchive, FileAudio,
  FileCode2, FileCog, FileDiff, FileImage, FileJson, FilePlus2,
  FileSpreadsheet, FileTerminal, FileText, FileVideo, Folder, FolderOpen,
  FolderTree, GitBranch, Globe, GripVertical, History, LayoutDashboard, LoaderCircle,
  MessageSquare, MessageSquarePlus, MessageSquareWarning, NotebookText, PanelLeftClose, PanelRight, Paperclip, Pencil, Pin, Play, Plus,
  Quote, RefreshCw, Replace, ReplaceAll, Save, Search, Send, Settings, ShieldCheck, Sparkles, Square,
  SquareKanban, TerminalSquare, Trash2, Undo2, Upload, User, Waypoints, Wrench, X, Zap,
  type LucideIcon,
  type LucideProps
} from "lucide-react";

/**
 * Icon size ladder. Icons are sized only through these tokens — the rendered
 * pixel value is an implementation detail of this file.
 *
 * - `inline`    in-text hints, badges, metadata, graph nodes
 * - `dense`     trees, list rows, tabs, dense toolbars
 * - `default`   toolbar buttons, icon buttons, top bar
 * - `prominent` empty states, heroes, settings headers
 */
export const ICON_SIZE = {
  inline: 12,
  dense: 13,
  default: 16,
  prominent: 20
} as const;

export type ThemeIconSize = (typeof ICON_SIZE)[keyof typeof ICON_SIZE];

/** Semantic icon registry. A missing built-in icon is a compile-time error. */
const ICONS = {
  activity: Activity, archive: Archive, "arrow-down": ArrowDown, "arrow-down-to-line": ArrowDownToLine,
  "arrow-left": ArrowLeft, "arrow-right": ArrowRight,
  "arrow-up": ArrowUp, "arrow-up-to-line": ArrowUpToLine, "at-sign": AtSign, bell: Bell, bot: Bot, check: Check,
  "chevron-down": ChevronDown, "chevron-left": ChevronLeft, "chevron-right": ChevronRight, "chevron-up": ChevronUp,
  circle: Circle, clipboard: Clipboard, cloud: Cloud, command: Command, copy: Copy,
  download: Download, ellipsis: Ellipsis, "external-link": ExternalLink, eye: Eye, "eye-off": EyeOff,
  file: File, "file-archive": FileArchive, "file-audio": FileAudio, "file-code": FileCode2,
  "file-cog": FileCog, "file-diff": FileDiff, "file-image": FileImage, "file-json": FileJson,
  "file-plus": FilePlus2, "file-spreadsheet": FileSpreadsheet, "file-terminal": FileTerminal,
  "file-text": FileText, "file-video": FileVideo, folder: Folder, "folder-open": FolderOpen,
  "folder-tree": FolderTree, "git-branch": GitBranch, globe: Globe, "grip-vertical": GripVertical,
  history: History, "layout-dashboard": LayoutDashboard, loader: LoaderCircle,
  "message-square": MessageSquare, "message-square-plus": MessageSquarePlus, "message-square-warning": MessageSquareWarning,
  notebook: NotebookText,
  "panel-left": PanelLeftClose,
  "panel-right": PanelRight, paperclip: Paperclip, pencil: Pencil, pin: Pin, play: Play, plus: Plus,
  "app-window": AppWindow,
  quote: Quote, refresh: RefreshCw, replace: Replace, "replace-all": ReplaceAll, save: Save, search: Search, send: Send, settings: Settings,
  "shield-check": ShieldCheck, sparkles: Sparkles, square: Square, "square-kanban": SquareKanban,
  terminal: TerminalSquare,
  trash: Trash2, undo: Undo2, upload: Upload, user: User, waypoints: Waypoints, wrench: Wrench, close: X,
  zap: Zap, "corner-down-right": CornerDownRight
} as const satisfies Record<string, LucideIcon>;

export type ThemeIconName = keyof typeof ICONS;
// `size`/`width`/`height`/`strokeWidth` are owned by this component so every icon
// shares one ladder, one stroke weight and one grid. See themeIconContract.test.ts.
type ThemeIconProps = Omit<LucideProps, "size" | "width" | "height" | "strokeWidth"> & {
  name: ThemeIconName;
  size?: ThemeIconSize;
};

/**
 * The one icon entry point for Desktop: lucide SVG on a 24px grid, 2px monoline
 * stroke, `currentColor`, decorative by default. Icons are chosen by semantic
 * name only — business views never import an icon library directly.
 */
export function ThemeIcon({ name, size = ICON_SIZE.default, ...props }: ThemeIconProps): JSX.Element {
  const Icon = ICONS[name];
  if (!Icon) return <span className="theme-icon-missing" data-theme-icon={name} aria-hidden="true" />;
  return <Icon data-theme-icon={name} width={size} height={size} aria-hidden="true" {...props} />;
}
