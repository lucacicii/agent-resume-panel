export const GTD_STATUSES = ["inbox", "next", "waiting", "someday", "reference", "done"] as const;
export type GtdStatus = (typeof GTD_STATUSES)[number];

/** Statuses that may be proposed or written by automated GTD workflows. */
export const GTD_ACTIVE_STATUSES = ["inbox", "next", "waiting", "someday", "reference", "done"] as const;
export type ActiveGtdStatus = (typeof GTD_ACTIVE_STATUSES)[number];

export function isGtdStatus(value: string): value is GtdStatus {
  return (GTD_STATUSES as readonly string[]).includes(value);
}

export function isActiveGtdStatus(value: string): value is ActiveGtdStatus {
  return (GTD_ACTIVE_STATUSES as readonly string[]).includes(value);
}
