import type { CSSProperties, ReactNode } from "react";

type SegmentedControlProps<T extends string> = {
  value: T;
  options: readonly T[];
  onChange: (value: T) => void;
  getLabel: (value: T) => ReactNode;
  "aria-label"?: string;
  className?: string;
};

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  getLabel,
  "aria-label": ariaLabel,
  className = "sidebar-project-filter-segmented",
}: SegmentedControlProps<T>): ReactNode {
  const activeIndex = Math.max(0, options.indexOf(value));
  const style = {
    "--segment-count": options.length,
    "--active-index": activeIndex,
  } as CSSProperties;

  return (
    <div className={className} role="tablist" aria-label={ariaLabel} style={style}>
      <span className="sidebar-project-filter-thumb" aria-hidden="true" />
      {options.map((option) => (
        <button
          type="button"
          key={option}
          role="tab"
          aria-selected={value === option}
          className={value === option ? "active" : ""}
          onClick={() => onChange(option)}
        >
          {getLabel(option)}
        </button>
      ))}
    </div>
  );
}
