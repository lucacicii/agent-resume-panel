export function normalizeModelBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

export function buildModelsUrl(baseUrl: string): string {
  let normalized = normalizeModelBaseUrl(baseUrl);
  if (normalized.endsWith("/chat/completions")) {
    normalized = normalized.slice(0, -"/chat/completions".length);
  }
  if (normalized.endsWith("/models")) {
    return normalized;
  }
  return `${normalized}/models`;
}

export function isLocalLlmEndpoint(baseUrl: string): boolean {
  try {
    const parsed = new URL(baseUrl);
    return (
      parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "::1" ||
      parsed.hostname === "[::1]"
    );
  } catch {
    return false;
  }
}

interface ModelsListResponse {
  data?: Array<{ id?: string; name?: string }>;
  models?: Array<{ id?: string; name?: string }>;
  error?: { message?: string };
}

export async function fetchAvailableModels(endpoint: {
  baseUrl: string;
  apiKey?: string;
}): Promise<string[]> {
  const url = buildModelsUrl(endpoint.baseUrl);
  const headers: Record<string, string> = {
    Accept: "application/json"
  };
  if (endpoint.apiKey?.trim()) {
    headers.Authorization = `Bearer ${endpoint.apiKey.trim()}`;
  }

  const response = await fetch(url, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(15_000)
  });

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`Failed to fetch models (status ${response.status}) from ${url}.`);
  }

  if (!response.ok) {
    const errObj = payload as ModelsListResponse;
    const message = errObj?.error?.message || `Failed to fetch models (status ${response.status}).`;
    throw new Error(`${message} (endpoint: ${url})`);
  }

  const list = Array.isArray(payload)
    ? (payload as Array<{ id?: string; name?: string }>)
    : ((payload as ModelsListResponse)?.data ?? (payload as ModelsListResponse)?.models ?? []);

  const ids = new Set<string>();
  for (const item of list) {
    const id =
      typeof item?.id === "string"
        ? item.id.trim()
        : typeof item?.name === "string"
          ? item.name.trim()
          : "";
    if (id) {
      ids.add(id);
    }
  }

  return [...ids].sort((a, b) => a.localeCompare(b));
}
