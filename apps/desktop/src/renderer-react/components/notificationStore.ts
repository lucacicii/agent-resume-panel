export type NotificationKind = "error" | "ok" | "info";

export interface DesktopNotificationInput {
  text: string;
  kind?: NotificationKind;
  durationMs?: number;
}

export interface NotificationEntry {
  id: number;
  text: string;
  kind: NotificationKind;
  timestamp: number;
}

export interface NotificationStoreConfig {
  maxHistory: number;
  autoClearMinutes: number;
}

type Listener = () => void;

const EVENT_NAME = "agent-resume:notification";

let history: NotificationEntry[] = [];
let nextId = 1;
let config: NotificationStoreConfig = { maxHistory: 100, autoClearMinutes: 60 };
let autoClearTimer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<Listener>();

function notifyListeners(): void {
  for (const listener of listeners) listener();
}

function trimToMax(): void {
  if (history.length > config.maxHistory) {
    history = history.slice(0, config.maxHistory);
  }
}

function purgeExpired(): void {
  if (config.autoClearMinutes <= 0) return;
  const cutoff = Date.now() - config.autoClearMinutes * 60_000;
  const before = history.length;
  history = history.filter((entry) => entry.timestamp >= cutoff);
  if (history.length !== before) notifyListeners();
}

function startAutoClear(): void {
  stopAutoClear();
  if (config.autoClearMinutes <= 0) return;
  autoClearTimer = setInterval(purgeExpired, config.autoClearMinutes * 60_000);
}

function stopAutoClear(): void {
  if (autoClearTimer !== null) {
    clearInterval(autoClearTimer);
    autoClearTimer = null;
  }
}

function dispatchToast(input: DesktopNotificationInput): void {
  window.dispatchEvent(new CustomEvent<DesktopNotificationInput>(EVENT_NAME, { detail: input }));
}

export function notify(input: DesktopNotificationInput): NotificationEntry {
  const entry: NotificationEntry = {
    id: nextId++,
    text: input.text,
    kind: input.kind ?? "info",
    timestamp: Date.now()
  };
  history = [entry, ...history];
  trimToMax();
  notifyListeners();
  dispatchToast(input);
  return entry;
}

export function getHistory(): NotificationEntry[] {
  return history;
}

export function getPage(page: number, pageSize: number): NotificationEntry[] {
  const start = page * pageSize;
  return history.slice(start, start + pageSize);
}

export function getTotalCount(): number {
  return history.length;
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function clearAll(): void {
  history = [];
  notifyListeners();
}

export function updateConfig(next: Partial<NotificationStoreConfig>): void {
  const prev = config;
  config = { ...config, ...next };
  if (prev.autoClearMinutes !== config.autoClearMinutes) {
    startAutoClear();
  }
  if (prev.maxHistory !== config.maxHistory && history.length > config.maxHistory) {
    trimToMax();
    notifyListeners();
  }
}

export function getConfig(): Readonly<NotificationStoreConfig> {
  return config;
}
