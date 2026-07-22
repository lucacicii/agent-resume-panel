import { X } from "lucide-react";
import { useEffect, type ReactNode } from "react";

interface SheetProps {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  actions?: ReactNode;
  bodyClassName?: string;
  dismissible?: boolean;
}

export function Sheet({ open, title, children, onClose, wide = false, actions, bodyClassName, dismissible = true }: SheetProps): ReactNode {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && dismissible) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dismissible, onClose, open]);

  if (!open) return null;
  return (
    <div className="sheet" role="presentation">
      <button type="button" className="sheet-backdrop" aria-label={`Dismiss ${title}`} onClick={onClose} disabled={!dismissible} />
      <aside className={`sheet-panel${wide ? " sheet-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-head">
          <h3>{title}</h3>
          <div className="sheet-actions">
            {actions}
            {dismissible ? <button type="button" className="icon-btn" aria-label={`Close ${title}`} title={`Close ${title}`} onClick={onClose}>
              <X aria-hidden="true" />
            </button> : null}
          </div>
        </div>
        <div className={`sheet-body${bodyClassName ? ` ${bodyClassName}` : ""}`}>{children}</div>
      </aside>
    </div>
  );
}
