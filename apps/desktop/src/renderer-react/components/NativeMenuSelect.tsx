import { useRef } from "react";
import { ICON_SIZE, ThemeIcon } from "./ThemeIcon";
import { showContextMenuAt, type NativeContextMenuItem } from "../nativeContextMenu";

/**
 * A `<select>` rendered as a native macOS menu.
 *
 * Chromium draws the `<select>` popup itself, which is not the platform menu. This
 * keeps the trigger inline (current label + chevron) but opens an `NSMenu` through
 * the native context-menu bridge, matching the branch pickers and the rest of the
 * chrome. The option currently selected is shown with a checkmark.
 */
export function NativeMenuSelect<T extends string>({
  value,
  options,
  onChange,
  className,
  ariaLabel,
  title,
  disabled,
  emptyLabel,
  testId
}: {
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
  className?: string;
  ariaLabel: string;
  title?: string;
  disabled?: boolean;
  /**
   * Shown when `value` matches no option — a control whose subject is not known
   * yet (the mode chip before the daemon has answered) rather than one that is
   * simply empty. Without it the trigger renders a bare chevron.
   */
  emptyLabel?: string;
  testId?: string;
}): React.JSX.Element {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const current = options.find((option) => option.value === value);
  const label = current?.label ?? emptyLabel ?? "";

  const openMenu = async () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const valueById = new Map<string, T>();
    const items: NativeContextMenuItem[] = options.map((option) => {
      // Echo the value back as the item id ("" needs a real id to survive the
      // sanitizer, so the clear option gets a sentinel).
      const id = option.value === "" ? "__none__" : option.value;
      valueById.set(id, option.value);
      return { id, label: option.label, type: "checkbox", checked: option.value === value };
    });
    const chosen = await showContextMenuAt({ x: rect.left, y: rect.bottom + 4 }, items);
    const next = chosen ? valueById.get(chosen) : undefined;
    if (next !== undefined && next !== value) onChange(next);
  };

  return (
    <button
      ref={buttonRef}
      type="button"
      className={className}
      data-testid={testId}
      aria-label={`${ariaLabel}: ${label}`}
      aria-haspopup="menu"
      title={title ?? label}
      disabled={disabled}
      onClick={() => void openMenu()}
    >
      <span className="native-menu-select-label">{label}</span>
      <ThemeIcon name="chevron-down" size={ICON_SIZE.inline} aria-hidden="true" />
    </button>
  );
}
