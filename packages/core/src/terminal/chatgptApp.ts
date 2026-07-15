import { spawn } from "node:child_process";
import { AgentSession } from "../catalog/types";
import { expandHome } from "../pathUtils";

/** ChatGPT desktop app (formerly Codex app) deep-link scheme. */
export const CHATGPT_APP_URL_SCHEME = "codex";

export function buildChatGptThreadUrl(sessionId: string): string {
  const threadId = sessionId.trim();
  if (!threadId) {
    throw new Error("Session id is missing.");
  }
  return `${CHATGPT_APP_URL_SCHEME}://threads/${encodeURIComponent(threadId)}`;
}

export function buildChatGptNewTaskUrl(projectPath: string, prompt?: string): string {
  const absolutePath = expandHome(projectPath.trim());
  if (!absolutePath) {
    throw new Error("Project path is required.");
  }
  const params = new URLSearchParams();
  params.set("path", absolutePath);
  if (prompt?.trim()) {
    params.set("prompt", prompt.trim());
  }
  return `${CHATGPT_APP_URL_SCHEME}://threads/new?${params.toString()}`;
}

/** Open a Codex session in the ChatGPT desktop app via codex://threads/{id}. */
export async function openChatGptAppSession(session: AgentSession): Promise<void> {
  if (session.provider !== "codex") {
    throw new Error("Not a Codex session.");
  }
  await openChatGptDeepLink(buildChatGptThreadUrl(session.id));
}

export async function openChatGptAppProject(projectPath: string): Promise<void> {
  await openChatGptDeepLink(buildChatGptNewTaskUrl(projectPath));
}

export async function openChatGptDeepLink(url: string): Promise<void> {
  if (process.platform === "darwin") {
    await openDeepLinkOnMac(url);
    return;
  }

  if (process.platform === "win32") {
    await runDetached("cmd.exe", ["/c", "start", "", url]);
    return;
  }

  try {
    await runDetached("xdg-open", [url]);
  } catch {
    throw new Error(
      "Could not open ChatGPT desktop app. Install it and ensure codex:// links are registered."
    );
  }
}

async function openDeepLinkOnMac(url: string): Promise<void> {
  try {
    await runCommand("open", [url]);
    return;
  } catch (primaryError) {
    for (const appName of macChatGptAppNames()) {
      try {
        await runCommand("open", ["-a", appName, url]);
        return;
      } catch {
        // try next app name
      }
    }
    throw primaryError instanceof Error
      ? primaryError
      : new Error("Could not open ChatGPT desktop app. Install ChatGPT from OpenAI.");
  }
}

function macChatGptAppNames(): string[] {
  return ["ChatGPT", "Codex"];
}

function runDetached(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore"
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "ignore" });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code}`));
      }
    });
  });
}