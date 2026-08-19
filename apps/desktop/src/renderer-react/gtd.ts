export const GTD_STATUSES = ["inbox", "next", "waiting", "someday", "reference", "done"] as const;

export type GtdStatus = (typeof GTD_STATUSES)[number];
