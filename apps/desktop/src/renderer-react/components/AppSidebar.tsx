import { ICON_SIZE, ThemeIcon, type ThemeIconName } from "./ThemeIcon";
import { createPortal } from "react-dom";
import { useCallback, useRef } from "react";
import { desktopApi } from "../bridge";
import { useI18n } from "../i18n";
import { showContextMenuAt } from "../nativeContextMenu";
import { useGlideHighlight } from "./useGlideHighlight";

/** The board window's primary views, in nav order. */
export type BoardView = "gtd" | "notes";

/**
 * The board's full-height navigation sidebar (Finder-style): a traffic-light
 * strip on top with the primary views below, and the account menu pinned to
 * the rail's bottom. Nav hover feedback is the shared gliding highlight (see
 * `useGlideHighlight`); the account row, living outside the nav, owns its
 * hover fill.
 *
 * The collapse state is owned by the window (the toggle lives in the header),
 * so the sidebar only renders the rail the header asks for.
 */
export function AppSidebar({ view, onViewChange, collapsed }: {
  view: BoardView;
  onViewChange: (view: BoardView) => void;
  collapsed: boolean;
}): React.JSX.Element | null {
  const host = document.getElementById("react-nav");
  const { ready, t } = useI18n();
  const { containerRef: navRef, setRow, glide, moveGlide, hideGlide } = useGlideHighlight(view);
  const accountBtnRef = useRef<HTMLButtonElement | null>(null);

  const text = (key: string, fallback: string) => (ready ? t(key) : fallback);
  const items: Array<{ view: BoardView; icon: ThemeIconName; label: string }> = [
    { view: "gtd", icon: "square-kanban", label: text("desktop.nav.gtd", "GTD") },
    { view: "notes", icon: "notebook", label: text("desktop.nav.notes", "Notes") }
  ];

  /** Move the glide pill to a row; the active row keeps its own fill instead. */
  const move = useCallback((target: BoardView) => moveGlide(target), [moveGlide]);

  const navLabel = text("desktop.nav.label", "Navigation");
  const accountLabel = text("desktop.chrome.account", "Account");
  const settingsLabel = text("desktop.top.settings", "Settings");

  const openSettings = (pane = "general") => {
    // Settings lives in its own window (⌘,), so ask the main process for it.
    void desktopApi().openSettingsWindow?.({ pane }).catch(() => undefined);
  };

  /** The account menu is a native `NSMenu` anchored below the account row. */
  const openAccountMenu = async () => {
    const rect = accountBtnRef.current?.getBoundingClientRect();
    if (!rect) return;
    const chosen = await showContextMenuAt({ x: rect.left, y: rect.bottom + 4 }, [{ id: "settings", label: settingsLabel }]);
    if (chosen === "settings") openSettings();
  };

  if (!host) return null;
  return createPortal(
    <nav className={`app-sidebar${collapsed ? " is-collapsed" : ""}`} data-collapsed={collapsed} aria-label={navLabel}>
      {/* Traffic-light strip: drag space the macOS lights sit over. */}
      <div className="app-sidebar-top" aria-hidden="true" />
      <div className="app-sidebar-inner">
        <div
          ref={navRef}
          className="app-sidebar-nav"
          onPointerLeave={hideGlide}
        >
          <span
            className="app-sidebar-glide"
            style={{ top: glide.top, height: glide.height, opacity: glide.visible ? 1 : 0 }}
            aria-hidden="true"
          />
          {items.map((item) => {
            const active = item.view === view;
            return (
              <button
                key={item.view}
                ref={(node) => { setRow(item.view, node); }}
                type="button"
                className={`app-sidebar-row${active ? " is-active" : ""}`}
                aria-current={active ? "page" : undefined}
                aria-label={item.label}
                title={item.label}
                onClick={() => onViewChange(item.view)}
                onPointerEnter={() => move(item.view)}
              >
                <ThemeIcon name={item.icon} size={ICON_SIZE.default} />
                <span className="app-sidebar-copy">{item.label}</span>
              </button>
            );
          })}
        </div>
        {/* Account row: pinned to the rail bottom, outside the nav's glide. */}
        <div className="app-sidebar-footer">
          <button
            ref={accountBtnRef}
            type="button"
            className="app-sidebar-row"
            title={accountLabel}
            aria-label={accountLabel}
            aria-haspopup="menu"
            onClick={() => void openAccountMenu()}
          >
            <ThemeIcon name="user" size={ICON_SIZE.default} />
            <span className="app-sidebar-copy">{accountLabel}</span>
          </button>
        </div>
      </div>
    </nav>,
    host
  );
}
