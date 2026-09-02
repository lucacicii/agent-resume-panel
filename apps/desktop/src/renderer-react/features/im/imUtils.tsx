import { type CSSProperties, type JSX } from "react";
import type { ImJob, ImMember } from "../../../shared/imTypes";

export type Translate = (key: string, ...args: Array<string | number>) => string;

export interface PendingImage {
  id: string;
  fileName: string;
  mimeType: string;
  data: string;
  previewUrl: string;
  sizeBytes: number;
}

export const MAX_IMAGES = 4;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export const BUILTIN_ROLE_KEYS: Record<string, "productManager" | "architect" | "projectManager" | "uiDesigner" | "developer" | "tester" | "memory"> = {
  role_product_manager: "productManager",
  product_manager: "productManager",
  productManager: "productManager",
  "Product Manager": "productManager",
  role_architect: "architect",
  architect: "architect",
  Architect: "architect",
  arch: "architect",
  role_project_manager: "projectManager",
  project_manager: "projectManager",
  projectManager: "projectManager",
  "Project Manager": "projectManager",
  role_ui_designer: "uiDesigner",
  ui_designer: "uiDesigner",
  uiDesigner: "uiDesigner",
  "UI Designer": "uiDesigner",
  ui: "uiDesigner",
  UI: "uiDesigner",
  role_developer: "developer",
  developer: "developer",
  Developer: "developer",
  develop: "developer",
  dev: "developer",
  role_tester: "tester",
  tester: "tester",
  Tester: "tester",
  qa: "tester",
  role_memory: "memory",
  memory: "memory",
  Memory: "memory",
  archivist: "memory"
};

export const BUILTIN_ROLE_COLORS: Record<string, string> = {
  role_product_manager: "hsl(265 70% 58%)",
  product_manager: "hsl(265 70% 58%)",
  productManager: "hsl(265 70% 58%)",
  "Product Manager": "hsl(265 70% 58%)",
  role_architect: "hsl(217 91% 60%)",
  architect: "hsl(217 91% 60%)",
  Architect: "hsl(217 91% 60%)",
  arch: "hsl(217 91% 60%)",
  role_project_manager: "hsl(199 92% 52%)",
  project_manager: "hsl(199 92% 52%)",
  projectManager: "hsl(199 92% 52%)",
  "Project Manager": "hsl(199 92% 52%)",
  role_ui_designer: "hsl(330 72% 58%)",
  ui_designer: "hsl(330 72% 58%)",
  uiDesigner: "hsl(330 72% 58%)",
  "UI Designer": "hsl(330 72% 58%)",
  ui: "hsl(330 72% 58%)",
  UI: "hsl(330 72% 58%)",
  role_developer: "hsl(152 76% 42%)",
  developer: "hsl(152 76% 42%)",
  Developer: "hsl(152 76% 42%)",
  develop: "hsl(152 76% 42%)",
  dev: "hsl(152 76% 42%)",
  role_tester: "hsl(35 92% 52%)",
  tester: "hsl(35 92% 52%)",
  Tester: "hsl(35 92% 52%)",
  qa: "hsl(35 92% 52%)",
  role_memory: "hsl(175 80% 40%)",
  memory: "hsl(175 80% 40%)",
  Memory: "hsl(175 80% 40%)"
};

export function storageBoolean(key: string, fallback = false): boolean {
  try {
    const val = localStorage.getItem(key);
    if (val == null) return fallback;
    return val === "1";
  } catch {
    return fallback;
  }
}

export function basename(value = ""): string {
  return value.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) || value;
}

export function isScratchPath(value?: string | null): boolean {
  if (!value) return true;
  const normalized = value.replaceAll("\\", "/");
  return normalized.includes("/.desktop/scratch/im/") || normalized.endsWith("/.desktop/scratch/im");
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export function cleanSnippet(body: string, max = 160): string {
  const plain = body
    .replace(/```[\s\S]*?```/g, " [code] ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/#+\s+/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_~>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= max) return plain;
  return `${plain.slice(0, max - 1)}…`;
}

export function parseDispatchBlocks(text: string): Array<{ target: string; reason?: string; instruction: string }> {
  const regex = /<im_dispatch\s+target="([^"]+)"(?:\s+reason="([^"]*)")?>([\s\S]*?)<\/im_dispatch>/gi;
  const blocks: Array<{ target: string; reason?: string; instruction: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const target = match[1]?.trim() || "";
    const reason = match[2]?.trim() || undefined;
    const instruction = match[3]?.trim() || "";
    if (target && instruction) {
      blocks.push({ target, reason, instruction });
    }
  }
  return blocks;
}

export function roleColor(templateId: string): string {
  const builtin = BUILTIN_ROLE_COLORS[templateId] || BUILTIN_ROLE_COLORS[templateId?.toLowerCase()];
  if (builtin) return builtin;
  let hash = 0;
  for (let i = 0; i < templateId.length; i++) {
    hash = (hash << 5) - hash + templateId.charCodeAt(i);
    hash |= 0;
  }
  return `hsl(${Math.abs(hash) % 360} 65% 50%)`;
}

export function roleInitial(label: string): string {
  return label.trim().charAt(0).toUpperCase() || "?";
}

export function dayKey(millis: number): string {
  const date = new Date(millis);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export function formatDay(millis: number, t: Translate): string {
  const date = new Date(millis);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startTarget = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diffDays = Math.round((startToday - startTarget) / 86_400_000);
  if (diffDays === 0) return t("desktop.im.today");
  if (diffDays === 1) return t("desktop.im.yesterday");
  return date.toLocaleDateString();
}

export function formatTime(millis: number): string {
  return new Date(millis).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export const ACTIVE_JOB_STATUSES = ["queued", "connecting", "running", "awaiting_user"] as const;

export function isActiveJobStatus(status: string): boolean {
  return (ACTIVE_JOB_STATUSES as readonly string[]).includes(status);
}

export function isInterruptedJobStatus(status: string): boolean {
  return status === "cancelled" || status === "failed";
}

export function isResumableJob(job: ImJob | undefined, jobs: ImJob[]): boolean {
  if (!job || !isInterruptedJobStatus(job.status)) return false;
  return !jobs.some((item) => item.memberId === job.memberId && item.createdAtMs > job.createdAtMs);
}

export function builtinRoleLabel(templateId: string, fallback: string, t: Translate): string {
  const key = BUILTIN_ROLE_KEYS[templateId] || BUILTIN_ROLE_KEYS[templateId?.toLowerCase()];
  if (!key) return fallback;
  return t(`desktop.im.role.${key}`);
}

export function roleLabel(member: ImMember, t: Translate): string {
  return builtinRoleLabel(member.templateId, member.name, t);
}

export function agentTag(agent: string, model: string | undefined, t: Translate): JSX.Element {
  return (
    <span className="s-provider-tag" data-provider={agent}>
      {t(`desktop.im.agent.${agent}`)}{model ? ` · ${model}` : ""}
    </span>
  );
}
