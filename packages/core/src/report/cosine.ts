export function parseEmbeddingJson(raw: string | null | undefined): number[] | null {
  if (!raw?.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || !parsed.length) {
      return null;
    }
    const nums = parsed.map((v) => Number(v));
    if (nums.some((n) => !Number.isFinite(n))) {
      return null;
    }
    return nums;
  } catch {
    return null;
  }
}

export function cosineSimilarity(a: number[], b: number[]): number | null {
  if (!a.length || a.length !== b.length) {
    return null;
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) {
    return null;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
