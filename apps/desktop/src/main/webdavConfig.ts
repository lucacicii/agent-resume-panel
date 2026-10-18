import { safeStorage } from "electron";
import { loadSettings, saveSettings, type PanelSettings, type WebdavBackupSettings } from "@agent-resume/core";
import {
  DEFAULT_WEBDAV_FOLDER,
  normalizeWebdavConfig,
  type WebdavConfig
} from "./webdavClient";

/**
 * WebDAV *server* credentials (HTTP Basic). These are not backup passwords:
 * backups are written as plain ZIPs and need no password to create or restore.
 *
 * The password is encrypted with Electron `safeStorage` (macOS Keychain) and
 * stored as base64 in `settings.desktop.json`. Plaintext never reaches disk,
 * logs, errors, or the renderer.
 */

export interface WebdavSettingsView {
  url: string;
  username: string;
  folder: string;
  hasPassword: boolean;
}

export interface SaveWebdavInput {
  url?: unknown;
  username?: unknown;
  folder?: unknown;
  /** Omitted or empty keeps the stored password; use `clearPassword` to remove it. */
  password?: unknown;
  clearPassword?: unknown;
}

function webdavSettings(settings: PanelSettings): WebdavBackupSettings | undefined {
  return settings.desktop?.backup?.webdav;
}

/** Renderer-facing view: never includes the password or its ciphertext. */
export function readWebdavSettings(settings: PanelSettings): WebdavSettingsView {
  const webdav = webdavSettings(settings);
  return {
    url: webdav?.url ?? "",
    username: webdav?.username ?? "",
    folder: webdav?.folder || DEFAULT_WEBDAV_FOLDER,
    hasPassword: Boolean(webdav?.passwordEncrypted)
  };
}

function encryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

export function encryptWebdavPassword(password: string): string {
  if (!encryptionAvailable()) {
    throw new Error("Secure storage is not available on this system, so the WebDAV password cannot be saved. Enter it again when you need it.");
  }
  return safeStorage.encryptString(password).toString("base64");
}

export function decryptWebdavPassword(ciphertext: string): string {
  if (!encryptionAvailable()) {
    throw new Error("Secure storage is not available on this system. Re-enter the WebDAV password.");
  }
  try {
    return safeStorage.decryptString(Buffer.from(ciphertext, "base64"));
  } catch {
    throw new Error("The saved WebDAV password could not be read. Enter it again.");
  }
}

/**
 * Build usable credentials for a request. An explicit password (draft value in
 * the UI) wins over the stored one.
 */
export function resolveWebdavCredentials(
  settings: PanelSettings,
  explicitPassword?: string
): WebdavConfig | null {
  const webdav = webdavSettings(settings);
  if (!webdav?.url || !webdav.username) return null;
  const password = explicitPassword?.length
    ? explicitPassword
    : webdav.passwordEncrypted
      ? decryptWebdavPassword(webdav.passwordEncrypted)
      : "";
  if (!password) throw new Error("Enter the WebDAV account password.");
  return normalizeWebdavConfig({
    url: webdav.url,
    username: webdav.username,
    folder: webdav.folder,
    password
  });
}

/**
 * Persist the server settings. Validation runs before anything is written, so a
 * bad URL cannot leave a half-configured target behind.
 */
export async function saveWebdavConfig(input: SaveWebdavInput): Promise<WebdavSettingsView> {
  const settings = await loadSettings();
  const previous = webdavSettings(settings) ?? {};
  const password = typeof input.password === "string" ? input.password : "";
  const clearPassword = input.clearPassword === true;

  const passwordEncrypted = clearPassword
    ? undefined
    : password.length
      ? encryptWebdavPassword(password)
      : previous.passwordEncrypted;

  // Validate the resulting config as a whole, but without requiring a password
  // here: it may already be stored, and the connection test is what proves it.
  const normalized = normalizeWebdavConfig({
    url: input.url,
    username: input.username,
    folder: input.folder,
    password: "placeholder"
  });

  const next: WebdavBackupSettings = {
    url: normalized.url,
    username: normalized.username,
    folder: normalized.folder,
    ...(passwordEncrypted ? { passwordEncrypted } : {})
  };

  await saveSettings({
    ...settings,
    desktop: {
      ...(settings.desktop ?? {}),
      backup: { ...(settings.desktop?.backup ?? {}), webdav: next }
    }
  });

  return readWebdavSettings(await loadSettings());
}
