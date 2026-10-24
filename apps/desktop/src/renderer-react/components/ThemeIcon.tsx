import type { JSX } from "react";
import {
  Activity, AppWindow, Archive, ArrowDown, ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUp, ArrowUpToLine, AtSign, Bell, Bot, Check,
  ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Circle, Clipboard, Clock, Cloud, Command,
  Copy, CornerDownRight, Download, Ellipsis, ExternalLink, Eye, EyeOff, File, FileArchive, FileHeadphone,
  FileCodeCorner, FileCog, FileDiff, FileImage, FileBraces, FilePlusCorner,
  FileSpreadsheet, FileTerminal, FileText, FilePlay, Folder, FolderOpen,
  FolderTree, GitBranch, Globe, GripVertical, RotateCcwClock, Inbox, LayoutDashboard, LoaderCircle,
  MessageSquare, MessageSquarePlus, MessageSquareWarning, NotebookText, PanelLeftClose, PanelRight, Paperclip, Pause, Pencil, Pin, Play, Plus,
  Quote, RefreshCw, Replace, ReplaceAll, Save, Search, Send, Settings, ShieldCheck, Sparkles, Square,
  SquareKanban, Target, SquareTerminal, Trash, Undo2, Upload, User, Waypoints, Wrench, X, Zap,
  type LucideIcon,
  type LucideProps
} from "lucide-react";

/**
 * Icon size ladder. Icons are sized only through these tokens — the rendered
 * pixel value is an implementation detail of this file.
 *
 * All tokens strictly evaluate to even pixel values for pixel-perfect
 * centering and sharp rendering on Retina (2x/3x) and standard (1x) displays:
 *
 * - `inline`    (12px) in-text hints, badges, metadata, graph nodes
 * - `dense`     (14px) file/folder trees, list rows, tabs, compact sidebars
 * - `default`   (16px) standard macOS toolbar buttons, icon buttons, inputs
 * - `prominent` (20px) hero actions, panel switchers, section headers
 * - `hero`      (24px) empty states, onboarding modals, large card icons
 */
export const ICON_SIZE = {
  inline: 12,
  dense: 14,
  default: 16,
  prominent: 20,
  hero: 24
} as const;

export type ThemeIconSize = (typeof ICON_SIZE)[keyof typeof ICON_SIZE];

/**
 * The one stroke weight for every icon in the app.
 *
 * Lucide draws on a 24px grid, so the weight scales with the icon: the default
 * of 2 renders as 1.0px of stroke at `inline` (12px), 1.17px at `dense` and
 * 1.33px at `default` — the same optical weight as the macOS system glyphs,
 * whose stems measure ~1.2px at 13pt. Setting it here, and never in CSS or per
 * call site, is what keeps the whole app on one weight.
 */
export const ICON_STROKE_WIDTH = 2;

/**
 * The Lucide registry: the compile-time contract for every icon the Desktop
 * renderer may draw, and the only place in the app that imports an icon
 * library. Lucide is the renderer's only icon system — the retired
 * `sf-symbols-lib` layer must not come back (themeIconContract.test.ts enforces
 * both).
 *
 * Keys are semantic so call sites never name a Lucide component: a Lucide
 * rename (`Trash2` → `Trash`, `History` → `RotateCcwClock`) is absorbed here
 * instead of rippling through ~440 call sites.
 */
const LUCIDE_ICONS = {
  activity: Activity, archive: Archive, "arrow-down": ArrowDown, "arrow-down-to-line": ArrowDownToLine,
  "arrow-left": ArrowLeft, "arrow-right": ArrowRight,
  "arrow-up": ArrowUp, "arrow-up-to-line": ArrowUpToLine, "at-sign": AtSign, bell: Bell, bot: Bot, check: Check,
  "chevron-down": ChevronDown, "chevron-left": ChevronLeft, "chevron-right": ChevronRight, "chevron-up": ChevronUp,
  circle: Circle, clipboard: Clipboard, clock: Clock, cloud: Cloud, command: Command, copy: Copy,
  download: Download, ellipsis: Ellipsis, "external-link": ExternalLink, eye: Eye, "eye-off": EyeOff,
  file: File, "file-archive": FileArchive, "file-audio": FileHeadphone, "file-code": FileCodeCorner,
  "file-cog": FileCog, "file-diff": FileDiff, "file-image": FileImage, "file-json": FileBraces,
  "file-plus": FilePlusCorner, "file-spreadsheet": FileSpreadsheet, "file-terminal": FileTerminal,
  "file-text": FileText, "file-video": FilePlay, folder: Folder, "folder-open": FolderOpen,
  "folder-tree": FolderTree, "git-branch": GitBranch, globe: Globe, "grip-vertical": GripVertical,
  history: RotateCcwClock, inbox: Inbox, "layout-dashboard": LayoutDashboard, loader: LoaderCircle,
  "message-square": MessageSquare, "message-square-plus": MessageSquarePlus, "message-square-warning": MessageSquareWarning,
  notebook: NotebookText,
  "panel-left": PanelLeftClose,
  "panel-right": PanelRight, paperclip: Paperclip, pause: Pause, pencil: Pencil, pin: Pin, play: Play, plus: Plus,
  "app-window": AppWindow,
  quote: Quote, refresh: RefreshCw, replace: Replace, "replace-all": ReplaceAll, save: Save, search: Search, send: Send, settings: Settings,
  "shield-check": ShieldCheck, sparkles: Sparkles, square: Square, "square-kanban": SquareKanban, target: Target,
  terminal: SquareTerminal,
  trash: Trash, undo: Undo2, upload: Upload, user: User, waypoints: Waypoints, wrench: Wrench, close: X,
  zap: Zap, "corner-down-right": CornerDownRight
} as const satisfies Record<string, LucideIcon>;

export type ThemeIconName = keyof typeof LUCIDE_ICONS;

// `size`/`width`/`height`/`strokeWidth`/`absoluteStrokeWidth` are owned by this
// component so every icon shares one ladder, one stroke weight and one grid.
// `absoluteStrokeWidth` is omitted for the same reason it is not used below: it
// pins the stroke to a fixed pixel value and would break the scaling that
// ICON_STROKE_WIDTH depends on. See themeIconContract.test.ts.
export type ThemeIconProps = Omit<
  LucideProps,
  "size" | "width" | "height" | "strokeWidth" | "absoluteStrokeWidth"
> & {
  name: ThemeIconName;
  size?: ThemeIconSize;
};

/**
 * The unified icon entry point for Desktop.
 *
 * Icons are chosen by semantic name only — business views never import an icon
 * library directly. The props spread stays ahead of `width`/`height` so a call
 * site can still tint an individual icon with `color`/`fill` (the coloured file
 * tree glyphs and the git log's solid dots rely on it), and `strokeWidth` stays
 * last so no call site can take the app off its single stroke weight.
 */
export function ThemeIcon({
  name,
  size = ICON_SIZE.default,
  className,
  ...props
}: ThemeIconProps): JSX.Element {
  // The registry lookup is typed as a union of 84 distinct components, which JSX
  // prop-checking cannot accept; widen it back to the shared icon signature.
  const Icon = LUCIDE_ICONS[name] as LucideIcon | undefined;
  if (!Icon) {
    return <span className="theme-icon-missing" data-theme-icon={name} aria-hidden="true" />;
  }

  return (
    <Icon
      data-theme-icon={name}
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      {...props}
      strokeWidth={ICON_STROKE_WIDTH}
    />
  );
}
