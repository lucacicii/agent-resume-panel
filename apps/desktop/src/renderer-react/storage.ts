export function storedWidth(key: string, fallback: number, min: number, max: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null || raw.trim() === "") return fallback;
    const value = Number(raw);
    return Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
  } catch {
    return fallback;
  }
}
