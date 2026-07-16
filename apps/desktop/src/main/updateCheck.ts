import { app } from "electron";

export const RELEASE_REPO = "thunder-luc/agent-resume-desktop-doc";
const GITHUB_API_URL = `https://api.github.com/repos/${RELEASE_REPO}/releases/latest`;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export type UpdateCheckError = "network" | "parse" | "rate_limit";

export interface UpdateCheckSuccess {
  ok: true;
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  releaseUrl: string;
  downloadUrl: string | null;
  checkedAt: number;
}

export interface UpdateCheckFailure {
  ok: false;
  currentVersion: string;
  error: UpdateCheckError;
  checkedAt: number;
}

export type UpdateCheckResult = UpdateCheckSuccess | UpdateCheckFailure;

interface GithubReleaseAsset {
  name?: string;
  browser_download_url?: string;
}

interface GithubReleasePayload {
  tag_name?: string;
  html_url?: string;
  assets?: GithubReleaseAsset[];
}

let cachedResult: UpdateCheckResult | null = null;
let cachedAt = 0;

export function normalizeSemver(version: string): [number, number, number] | null {
  const trimmed = version.trim().replace(/^v/i, "");
  const core = trimmed.split("-")[0]?.split("+")[0] ?? "";
  const parts = core.split(".");
  if (parts.length < 1 || parts.length > 3) {
    return null;
  }
  const numbers = parts.map((part) => Number.parseInt(part, 10));
  if (numbers.some((value) => !Number.isFinite(value) || value < 0)) {
    return null;
  }
  while (numbers.length < 3) {
    numbers.push(0);
  }
  return [numbers[0], numbers[1], numbers[2]];
}

/** Returns 1 if a > b, -1 if a < b, 0 if equal. */
export function compareSemver(a: string, b: string): number | null {
  const left = normalizeSemver(a);
  const right = normalizeSemver(b);
  if (!left || !right) {
    return null;
  }
  for (let i = 0; i < 3; i++) {
    if (left[i] > right[i]) return 1;
    if (left[i] < right[i]) return -1;
  }
  return 0;
}

export function parseReleaseTag(tagName: string | undefined): string | null {
  if (!tagName || typeof tagName !== "string") {
    return null;
  }
  const version = tagName.trim().replace(/^v/i, "");
  return normalizeSemver(version) ? version : null;
}

export function pickDmgDownloadUrl(assets: GithubReleaseAsset[] | undefined): string | null {
  if (!Array.isArray(assets)) {
    return null;
  }
  const dmgs = assets.filter(
    (asset) =>
      typeof asset.name === "string" &&
      asset.name.endsWith(".dmg") &&
      typeof asset.browser_download_url === "string"
  );
  const preferred = dmgs.find((asset) => asset.name?.startsWith("Agent Resume-"));
  const chosen = preferred ?? dmgs[0];
  return chosen?.browser_download_url ?? null;
}

export function parseGithubRelease(payload: unknown): {
  latestVersion: string;
  releaseUrl: string;
  downloadUrl: string | null;
} | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const release = payload as GithubReleasePayload;
  const latestVersion = parseReleaseTag(release.tag_name);
  const releaseUrl = typeof release.html_url === "string" ? release.html_url : "";
  if (!latestVersion || !releaseUrl) {
    return null;
  }
  return {
    latestVersion,
    releaseUrl,
    downloadUrl: pickDmgDownloadUrl(release.assets)
  };
}

function isCacheFresh(force: boolean): boolean {
  if (force || !cachedResult) {
    return false;
  }
  return Date.now() - cachedAt < CACHE_TTL_MS;
}

function failureResult(currentVersion: string, error: UpdateCheckError): UpdateCheckFailure {
  return {
    ok: false,
    currentVersion,
    error,
    checkedAt: Date.now()
  };
}

export function getAppVersion(): string {
  return app.getVersion();
}

export async function checkForDesktopUpdate(options?: { force?: boolean }): Promise<UpdateCheckResult> {
  const currentVersion = getAppVersion();
  if (isCacheFresh(options?.force === true)) {
    return cachedResult!;
  }

  let response: Response;
  try {
    response = await fetch(GITHUB_API_URL, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": `Agent-Resume-Desktop/${currentVersion}`
      },
      signal: AbortSignal.timeout(15_000)
    });
  } catch {
    const result = failureResult(currentVersion, "network");
    cachedResult = result;
    cachedAt = Date.now();
    return result;
  }

  if (response.status === 403 || response.status === 429) {
    const result = failureResult(currentVersion, "rate_limit");
    cachedResult = result;
    cachedAt = Date.now();
    return result;
  }

  if (!response.ok) {
    const result = failureResult(currentVersion, "network");
    cachedResult = result;
    cachedAt = Date.now();
    return result;
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    const result = failureResult(currentVersion, "parse");
    cachedResult = result;
    cachedAt = Date.now();
    return result;
  }

  const parsed = parseGithubRelease(payload);
  if (!parsed) {
    const result = failureResult(currentVersion, "parse");
    cachedResult = result;
    cachedAt = Date.now();
    return result;
  }

  const comparison = compareSemver(parsed.latestVersion, currentVersion);
  const updateAvailable = comparison === 1;

  const result: UpdateCheckSuccess = {
    ok: true,
    currentVersion,
    latestVersion: parsed.latestVersion,
    updateAvailable,
    releaseUrl: parsed.releaseUrl,
    downloadUrl: parsed.downloadUrl,
    checkedAt: Date.now()
  };
  cachedResult = result;
  cachedAt = Date.now();
  return result;
}