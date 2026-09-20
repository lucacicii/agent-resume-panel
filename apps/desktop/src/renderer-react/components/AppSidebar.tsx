import { ICON_SIZE, ThemeIcon, type ThemeIconName } from "./ThemeIcon";
import { createPortal } from "react-dom";
import { useCallback, useState } from "react";
import { useI18n } from "../i18n";
import { useGlideHighlight } from "./useGlideHighlight";

/** The board window's primary views, in nav order. */
export type BoardView = "gtd" | "notes";

const NAV_COLLAPSED_KEY = "board-nav-collapsed";

function storedCollapsed(): boolean {
  try {
    return localStorage.getItem(NAV_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * The board's full-height navigation sidebar (Finder-style): a traffic-light
 * strip on top, the primary views below, and the collapse toggle at the bottom.
 * Hover feedback is the shared gliding highlight (see `useGlideHighlight`).
 */
export function AppSidebar({ view, onViewChange }: {
  view: BoardView;
  onViewChange: (view: BoardView) => void;
}): React.JSX.Element | null {
  const host = document.getElementById("react-nav");
  const { ready, t } = useI18n();
  const [collapsed, setCollapsed] = useState(storedCollapsed);
  const { containerRef: navRef, setRow, glide, moveGlide, hideGlide } = useGlideHighlight(view);

  const text = (key: string, fallback: string) => (ready ? t(key) : fallback);
  const items: Array<{ view: BoardView; icon: ThemeIconName; label: string }> = [
    { view: "gtd", icon: "square-kanban", label: text("desktop.nav.gtd", "GTD") },
    { view: "notes", icon: "notebook", label: text("desktop.nav.notes", "Notes") }
  ];

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(NAV_COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        /* persistence is optional */
      }
      return next;
    });
  }, []);

  /** Move the glide pill to a row; the active row keeps its own fill instead. */
  const move = useCallback((target: BoardView) => moveGlide(target), [moveGlide]);

  const navLabel = text("desktop.nav.label", "Navigation");
  const collapseLabel = collapsed
    ? text("desktop.nav.expand", "Expand sidebar")
    : text("desktop.nav.collapse", "Collapse sidebar");

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
        <div className="app-sidebar-footer">
          <button
            type="button"
            className="app-sidebar-row app-sidebar-collapse"
            aria-label={collapseLabel}
            title={collapseLabel}
            aria-expanded={!collapsed}
            onClick={toggleCollapsed}
          >
            <ThemeIcon name="panel-left" size={ICON_SIZE.default} />
            <span className="app-sidebar-copy">{collapseLabel}</span>
          </button>
        </div>
      </div>
    </nav>,
    host
  );
}
