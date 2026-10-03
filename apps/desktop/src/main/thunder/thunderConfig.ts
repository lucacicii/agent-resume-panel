import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ThunderModelsConfig } from "@agent-resume/core";

/**
 * Direct read/write access to Thunder's own config files
 * (`~/.thunder/models.json`).
 *
 * The daemon reloads the file per request, so edits here take effect on the
 * very next `run_task` — no daemon restart involved.
 *
 * The store's directory is injectable so unit tests can run against a
 * tempdir instead of the user's real `~/.thunder`.
 */

export interface ThunderConfigStore {
  readModelsConfig(): ThunderModelsConfig;
  writeModelsConfig(config: ThunderModelsConfig): void;
}

/** Write with a `.bak` of the previous file and an atomic rename. */
function atomicWrite(file: string, contents: string): void {
  try {
    fs.copyFileSync(file, `${file}.bak`);
  } catch {
    // No previous file to back up.
  }
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, contents, "utf8");
  fs.renameSync(tmp, file);
}

export function createThunderConfigStore(dir?: string): ThunderConfigStore {
  const base = dir ?? path.join(os.homedir(), ".thunder");
  const modelsPath = path.join(base, "models.json");

  return {
    readModelsConfig(): ThunderModelsConfig {
      const text = fs.readFileSync(modelsPath, "utf8");
      const value = JSON.parse(text) as unknown;
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("models.json: expected a top-level object");
      }
      const record = value as Record<string, unknown>;
      if (
        record.providers !== undefined &&
        (typeof record.providers !== "object" || Array.isArray(record.providers))
      ) {
        throw new Error("models.json: `providers` must be an object keyed by provider id");
      }
      return {
        providers: (record.providers as ThunderModelsConfig["providers"]) ?? {},
        utilityModel:
          typeof record.utilityModel === "string" ? record.utilityModel : undefined
      };
    },

    writeModelsConfig(config: ThunderModelsConfig): void {
      if (!config || typeof config !== "object" || Array.isArray(config)) {
        throw new Error("models config: expected an object");
      }
      if (
        !config.providers ||
        typeof config.providers !== "object" ||
        Array.isArray(config.providers)
      ) {
        throw new Error("models config: `providers` must be an object keyed by provider id");
      }
      for (const [id, provider] of Object.entries(config.providers)) {
        if (!id.trim()) {
          throw new Error("Provider id cannot be empty");
        }
        if (
          provider &&
          typeof provider === "object" &&
          typeof provider.apiKey === "string" &&
          !provider.apiKey.trim()
        ) {
          throw new Error(
            `Provider "${id}": apiKey cannot be empty (remove the provider instead)`
          );
        }
      }
      const payload: Record<string, unknown> = { providers: config.providers };
      if (config.utilityModel) payload.utilityModel = config.utilityModel;
      fs.mkdirSync(base, { recursive: true });
      atomicWrite(modelsPath, `${JSON.stringify(payload, null, 2)}\n`);
    }
  };
}

/** The user's real `~/.thunder` store. */
export const thunderConfigStore = createThunderConfigStore();

export const thunderConfigPaths = {
  dir: () => path.join(os.homedir(), ".thunder"),
  models: () => path.join(os.homedir(), ".thunder", "models.json")
};
