import { Children, isValidElement, type ReactNode } from "react";
import { NativeMenuSelect } from "./NativeMenuSelect";

/**
 * The two shapes almost every settings surface is built from. They began inside
 * the settings panes; the task settings sheet needs the same rows, so they live
 * here rather than being copied into a second file.
 */

export function ToggleRow({ title, description, checked, onChange }: { title: string; description?: string; checked: boolean; onChange: (checked: boolean) => void }): ReactNode {
  return <label className="settings-row"><span className="settings-row-label"><span className="settings-row-title">{title}</span>{description ? <span className="settings-row-desc">{description}</span> : null}</span><span className="settings-toggle"><input type="checkbox" role="switch" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span className="settings-toggle-track" aria-hidden="true" /></span></label>;
}

export function SelectRow({ title, description, value, onChange, children }: { title: string; description?: string; value: string | number; onChange: (value: string) => void; children: ReactNode }): ReactNode {
  // The caller keeps the declarative `<option>` children; read them into the
  // value/label pairs the native menu needs.
  const options = Children.toArray(children).flatMap((child) => {
    if (!isValidElement(child)) return [];
    const props = child.props as { value?: string | number; children?: ReactNode };
    if (props.value === undefined) return [];
    return [{ value: String(props.value), label: String(props.children ?? props.value) }];
  });
  return <label className="settings-row"><span className="settings-row-label"><span className="settings-row-title">{title}</span>{description ? <span className="settings-row-desc">{description}</span> : null}</span><NativeMenuSelect className="settings-row-control" ariaLabel={title} title={title} value={String(value)} options={options} onChange={onChange} /></label>;
}
