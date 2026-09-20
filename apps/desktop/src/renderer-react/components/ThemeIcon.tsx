import type { ComponentType, JSX } from "react";
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

import { SFWaveformPathEcg } from "sf-symbols-lib/monochrome/SFWaveformPathEcg";
import { SFArchivebox } from "sf-symbols-lib/monochrome/SFArchivebox";
import { SFArrowDown } from "sf-symbols-lib/monochrome/SFArrowDown";
import { SFArrowDownToLine } from "sf-symbols-lib/monochrome/SFArrowDownToLine";
import { SFArrowLeft } from "sf-symbols-lib/monochrome/SFArrowLeft";
import { SFArrowRight } from "sf-symbols-lib/monochrome/SFArrowRight";
import { SFArrowUp } from "sf-symbols-lib/monochrome/SFArrowUp";
import { SFArrowUpToLine } from "sf-symbols-lib/monochrome/SFArrowUpToLine";
import { SFAt } from "sf-symbols-lib/monochrome/SFAt";
import { SFBell } from "sf-symbols-lib/monochrome/SFBell";
import { SFCpu } from "sf-symbols-lib/monochrome/SFCpu";
import { SFCheckmark } from "sf-symbols-lib/monochrome/SFCheckmark";
import { SFChevronDown } from "sf-symbols-lib/monochrome/SFChevronDown";
import { SFChevronLeft } from "sf-symbols-lib/monochrome/SFChevronLeft";
import { SFChevronRight } from "sf-symbols-lib/monochrome/SFChevronRight";
import { SFChevronUp } from "sf-symbols-lib/monochrome/SFChevronUp";
import { SFCircle } from "sf-symbols-lib/monochrome/SFCircle";
import { SFClipboard } from "sf-symbols-lib/monochrome/SFClipboard";
import { SFCloud } from "sf-symbols-lib/monochrome/SFCloud";
import { SFCommand } from "sf-symbols-lib/monochrome/SFCommand";
import { SFDocumentOnDocument } from "sf-symbols-lib/monochrome/SFDocumentOnDocument";
import { SFArrowDownCircle } from "sf-symbols-lib/monochrome/SFArrowDownCircle";
import { SFEllipsis } from "sf-symbols-lib/monochrome/SFEllipsis";
import { SFArrowUpForwardSquare } from "sf-symbols-lib/monochrome/SFArrowUpForwardSquare";
import { SFEye } from "sf-symbols-lib/monochrome/SFEye";
import { SFEyeSlash } from "sf-symbols-lib/monochrome/SFEyeSlash";
import { SFDocument } from "sf-symbols-lib/monochrome/SFDocument";
import { SFZipperPage } from "sf-symbols-lib/monochrome/SFZipperPage";
import { SFWaveform } from "sf-symbols-lib/monochrome/SFWaveform";
import { SFChevronLeftForwardslashChevronRight } from "sf-symbols-lib/monochrome/SFChevronLeftForwardslashChevronRight";
import { SFDocumentBadgeGearshape } from "sf-symbols-lib/monochrome/SFDocumentBadgeGearshape";
import { SFPhoto } from "sf-symbols-lib/monochrome/SFPhoto";
import { SFCurlybraces } from "sf-symbols-lib/monochrome/SFCurlybraces";
import { SFDocumentBadgePlus } from "sf-symbols-lib/monochrome/SFDocumentBadgePlus";
import { SFTablecells } from "sf-symbols-lib/monochrome/SFTablecells";
import { SFAppleTerminalOnRectangle } from "sf-symbols-lib/monochrome/SFAppleTerminalOnRectangle";
import { SFTextPage } from "sf-symbols-lib/monochrome/SFTextPage";
import { SFFilm } from "sf-symbols-lib/monochrome/SFFilm";
import { SFFolder } from "sf-symbols-lib/monochrome/SFFolder";
import { SFFolderFill } from "sf-symbols-lib/monochrome/SFFolderFill";
import { SFListBulletIndent } from "sf-symbols-lib/monochrome/SFListBulletIndent";
import { SFArrowTriangleheadBranch } from "sf-symbols-lib/monochrome/SFArrowTriangleheadBranch";
import { SFGlobe } from "sf-symbols-lib/monochrome/SFGlobe";
import { SFClockArrowTriangleheadCounterclockwiseRotate90 } from "sf-symbols-lib/monochrome/SFClockArrowTriangleheadCounterclockwiseRotate90";
import { SFSquareGrid2x2 } from "sf-symbols-lib/monochrome/SFSquareGrid2x2";
import { SFProgressIndicator } from "sf-symbols-lib/monochrome/SFProgressIndicator";
import { SFBubbleLeft } from "sf-symbols-lib/monochrome/SFBubbleLeft";
import { SFBubbleLeftAndBubbleRight } from "sf-symbols-lib/monochrome/SFBubbleLeftAndBubbleRight";
import { SFBubbleLeftAndExclamationmarkBubbleRight } from "sf-symbols-lib/monochrome/SFBubbleLeftAndExclamationmarkBubbleRight";
import { SFBookPages } from "sf-symbols-lib/monochrome/SFBookPages";
import { SFSidebarLeft } from "sf-symbols-lib/monochrome/SFSidebarLeft";
import { SFSidebarRight } from "sf-symbols-lib/monochrome/SFSidebarRight";
import { SFPaperclip } from "sf-symbols-lib/monochrome/SFPaperclip";
import { SFPencil } from "sf-symbols-lib/monochrome/SFPencil";
import { SFPin } from "sf-symbols-lib/monochrome/SFPin";
import { SFPlay } from "sf-symbols-lib/monochrome/SFPlay";
import { SFPlus } from "sf-symbols-lib/monochrome/SFPlus";
import { SFMacwindow } from "sf-symbols-lib/monochrome/SFMacwindow";
import { SFQuoteOpening } from "sf-symbols-lib/monochrome/SFQuoteOpening";
import { SFArrowClockwise } from "sf-symbols-lib/monochrome/SFArrowClockwise";
import { SFArrowTrianglehead2ClockwiseRotate90 } from "sf-symbols-lib/monochrome/SFArrowTrianglehead2ClockwiseRotate90";
import { SFArrowTrianglehead2ClockwiseRotate90Circle } from "sf-symbols-lib/monochrome/SFArrowTrianglehead2ClockwiseRotate90Circle";
import { SFSquareAndArrowDown } from "sf-symbols-lib/monochrome/SFSquareAndArrowDown";
import { SFMagnifyingglass } from "sf-symbols-lib/monochrome/SFMagnifyingglass";
import { SFPaperplane } from "sf-symbols-lib/monochrome/SFPaperplane";
import { SFGearshape } from "sf-symbols-lib/monochrome/SFGearshape";
import { SFCheckmarkShield } from "sf-symbols-lib/monochrome/SFCheckmarkShield";
import { SFSparkles } from "sf-symbols-lib/monochrome/SFSparkles";
import { SFSquare } from "sf-symbols-lib/monochrome/SFSquare";
import { SFRectangleSplit3x1 } from "sf-symbols-lib/monochrome/SFRectangleSplit3x1";
import { SFAppleTerminal } from "sf-symbols-lib/monochrome/SFAppleTerminal";
import { SFTrash } from "sf-symbols-lib/monochrome/SFTrash";
import { SFArrowUturnBackward } from "sf-symbols-lib/monochrome/SFArrowUturnBackward";
import { SFArrowUpCircle } from "sf-symbols-lib/monochrome/SFArrowUpCircle";
import { SFPerson } from "sf-symbols-lib/monochrome/SFPerson";
import { SFPointTopleftDownToPointBottomrightCurvepath } from "sf-symbols-lib/monochrome/SFPointTopleftDownToPointBottomrightCurvepath";
import { SFWrenchAdjustable } from "sf-symbols-lib/monochrome/SFWrenchAdjustable";
import { SFXmark } from "sf-symbols-lib/monochrome/SFXmark";
import { SFBolt } from "sf-symbols-lib/monochrome/SFBolt";
import { SFArrowTurnDownRight } from "sf-symbols-lib/monochrome/SFArrowTurnDownRight";

/**
 * Icon size ladder. Icons are sized only through these tokens — the rendered
 * pixel value is an implementation detail of this file.
 *
 * - `inline`    in-text hints, badges, metadata, graph nodes
 * - `dense`     trees, list rows, tabs, dense toolbars
 * - `default`   toolbar buttons, icon buttons, top bar
 * - `prominent` empty states, heroes, settings headers
 */
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
 * Open Symbols (Lucide) registry. Acts as the compile-time contract and fallback
 * for any icon not mapped to a native SF Symbol.
 */
const OPEN_ICONS = {
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

export type ThemeIconName = keyof typeof OPEN_ICONS;

/**
 * Apple SF Symbols prioritized registry.
 * Mapped to native Apple SF Symbols for authentic macOS HIG design.
 */
const SF_ICONS: Partial<Record<ThemeIconName, ComponentType<any>>> = {
  activity: SFWaveformPathEcg,
  archive: SFArchivebox,
  "arrow-down": SFArrowDown,
  "arrow-down-to-line": SFArrowDownToLine,
  "arrow-left": SFArrowLeft,
  "arrow-right": SFArrowRight,
  "arrow-up": SFArrowUp,
  "arrow-up-to-line": SFArrowUpToLine,
  "at-sign": SFAt,
  bell: SFBell,
  bot: SFCpu,
  check: SFCheckmark,
  "chevron-down": SFChevronDown,
  "chevron-left": SFChevronLeft,
  "chevron-right": SFChevronRight,
  "chevron-up": SFChevronUp,
  circle: SFCircle,
  clipboard: SFClipboard,
  cloud: SFCloud,
  command: SFCommand,
  copy: SFDocumentOnDocument,
  download: SFArrowDownCircle,
  ellipsis: SFEllipsis,
  "external-link": SFArrowUpForwardSquare,
  eye: SFEye,
  "eye-off": SFEyeSlash,
  file: SFDocument,
  "file-archive": SFZipperPage,
  "file-audio": SFWaveform,
  "file-code": SFChevronLeftForwardslashChevronRight,
  "file-cog": SFDocumentBadgeGearshape,
  "file-image": SFPhoto,
  "file-json": SFCurlybraces,
  "file-plus": SFDocumentBadgePlus,
  "file-spreadsheet": SFTablecells,
  "file-terminal": SFAppleTerminalOnRectangle,
  "file-text": SFTextPage,
  "file-video": SFFilm,
  folder: SFFolder,
  "folder-open": SFFolderFill,
  "folder-tree": SFListBulletIndent,
  "git-branch": SFArrowTriangleheadBranch,
  globe: SFGlobe,
  history: SFClockArrowTriangleheadCounterclockwiseRotate90,
  "layout-dashboard": SFSquareGrid2x2,
  loader: SFProgressIndicator,
  "message-square": SFBubbleLeft,
  "message-square-plus": SFBubbleLeftAndBubbleRight,
  "message-square-warning": SFBubbleLeftAndExclamationmarkBubbleRight,
  notebook: SFBookPages,
  "panel-left": SFSidebarLeft,
  "panel-right": SFSidebarRight,
  paperclip: SFPaperclip,
  pencil: SFPencil,
  pin: SFPin,
  play: SFPlay,
  plus: SFPlus,
  "app-window": SFMacwindow,
  quote: SFQuoteOpening,
  refresh: SFArrowClockwise,
  replace: SFArrowTrianglehead2ClockwiseRotate90,
  "replace-all": SFArrowTrianglehead2ClockwiseRotate90Circle,
  save: SFSquareAndArrowDown,
  search: SFMagnifyingglass,
  send: SFPaperplane,
  settings: SFGearshape,
  "shield-check": SFCheckmarkShield,
  sparkles: SFSparkles,
  square: SFSquare,
  "square-kanban": SFRectangleSplit3x1,
  terminal: SFAppleTerminal,
  trash: SFTrash,
  undo: SFArrowUturnBackward,
  upload: SFArrowUpCircle,
  user: SFPerson,
  waypoints: SFPointTopleftDownToPointBottomrightCurvepath,
  wrench: SFWrenchAdjustable,
  close: SFXmark,
  zap: SFBolt,
  "corner-down-right": SFArrowTurnDownRight
};

// `size`/`width`/`height`/`strokeWidth` are owned by this component so every icon
// shares one ladder, one stroke weight and one grid. See themeIconContract.test.ts.
export type ThemeIconProps = Omit<LucideProps, "size" | "width" | "height" | "strokeWidth"> & {
  name: ThemeIconName;
  size?: ThemeIconSize;
  preferOpenSymbol?: boolean;
};

/**
 * The unified icon entry point for Desktop.
 *
 * Prioritizes Apple SF Symbols for native macOS look and feel, falling back to
 * Open Symbols (Lucide) where appropriate. Icons are chosen by semantic name
 * only — business views never import an icon library directly.
 */
export function ThemeIcon({
  name,
  size = ICON_SIZE.default,
  preferOpenSymbol = false,
  className,
  ...props
}: ThemeIconProps): JSX.Element {
  if (!preferOpenSymbol) {
    const SFIcon = SF_ICONS[name];
    if (SFIcon) {
      return (
        <SFIcon
          data-theme-icon={name}
          data-icon-system="sf"
          size={size}
          className={className}
          aria-hidden="true"
          {...props}
        />
      );
    }
  }

  const OpenIcon = OPEN_ICONS[name];
  if (OpenIcon) {
    return (
      <OpenIcon
        data-theme-icon={name}
        data-icon-system="open"
        width={size}
        height={size}
        className={className}
        aria-hidden="true"
        {...props}
      />
    );
  }

  return <span className="theme-icon-missing" data-theme-icon={name} aria-hidden="true" />;
}
