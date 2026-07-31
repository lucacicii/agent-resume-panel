import type { ReactNode } from "react";

export type StatusKind = "ok" | "error" | "warning";

export function Status({ children, kind }: { children?: ReactNode; kind?: StatusKind }): ReactNode {
  if (!children) return null;
  return <p className={`status${kind ? ` ${kind}` : ""}`}>{children}</p>;
}
