import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import {
  ARP_CONFIG_VERSION,
  COMMIT_INSTRUCTION_MAX_CHARS,
  arpConfigPath,
  loadArpConfig,
  normalizeArpConfig,
  resolveCommitMessagePromptOptions
} from "../dist/index.js";

async function withTempDir(run) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "arp-config-"));
  try {
    return await run(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test("normalizeArpConfig keeps known workbench git fields and drops unknown keys", () => {
  const config = normalizeArpConfig({
    version: 1,
    extraTopLevel: true,
    shared: { language: "zh-CN" },
    im: { smartRoutingEnabled: false },
    workbench: {
      unused: 1,
      git: {
        unused: 2,
        commitMessage: {
          style: "gitmoji",
          customInstructions: "  team custom  ",
          extraInstructions: " scope must be a package name ",
          unknown: "nope"
        }
      }
    }
  });

  assert.deepEqual(config, {
    version: 1,
    workbench: {
      git: {
        commitMessage: {
          style: "gitmoji",
          customInstructions: "team custom",
          extraInstructions: "scope must be a package name"
        }
      }
    }
  });
});

test("normalizeArpConfig treats missing version as 1 and ignores invalid style", () => {
  const config = normalizeArpConfig({
    workbench: {
      git: {
        commitMessage: {
          style: "emoji",
          extraInstructions: "keep scopes short"
        }
      }
    }
  });

  assert.equal(config.version, ARP_CONFIG_VERSION);
  assert.deepEqual(config.workbench.git.commitMessage, {
    extraInstructions: "keep scopes short"
  });
});

test("normalizeArpConfig caps instruction length and rejects non-objects", () => {
  const long = "x".repeat(COMMIT_INSTRUCTION_MAX_CHARS + 50);
  const config = normalizeArpConfig({
    workbench: {
      git: {
        commitMessage: {
          style: "custom",
          customInstructions: long,
          extraInstructions: long
        }
      }
    }
  });

  assert.equal(config.workbench.git.commitMessage.customInstructions.length, COMMIT_INSTRUCTION_MAX_CHARS);
  assert.equal(config.workbench.git.commitMessage.extraInstructions.length, COMMIT_INSTRUCTION_MAX_CHARS);
  assert.equal(normalizeArpConfig(null), null);
  assert.equal(normalizeArpConfig("nope"), null);
  assert.equal(normalizeArpConfig([]), null);
});

test("loadArpConfig returns null for missing files, bad JSON, and parent-only configs", async () => {
  await withTempDir(async (dir) => {
    assert.equal(await loadArpConfig(""), null);
    assert.equal(await loadArpConfig(path.join(dir, "missing")), null);

    const child = path.join(dir, "child");
    await fs.mkdir(path.join(dir, ".arp"), { recursive: true });
    await fs.mkdir(child, { recursive: true });
    await fs.writeFile(arpConfigPath(dir), "{not json", "utf8");
    assert.equal(await loadArpConfig(dir), null);
    assert.equal(await loadArpConfig(child), null);

    await fs.writeFile(
      arpConfigPath(dir),
      JSON.stringify({
        version: 1,
        workbench: { git: { commitMessage: { style: "conventional" } } }
      }),
      "utf8"
    );
    const loaded = await loadArpConfig(dir);
    assert.equal(loaded.workbench.git.commitMessage.style, "conventional");
    assert.equal(await loadArpConfig(child), null);
  });
});

test("resolveCommitMessagePromptOptions overlays project git fields onto panel settings", () => {
  const panel = {
    workbench: {
      gitCommitMessageStyle: "custom",
      gitCommitCustomInstructions: "Use release-note style."
    }
  };

  assert.deepEqual(resolveCommitMessagePromptOptions(null, panel), {
    style: "custom",
    customInstructions: "Use release-note style."
  });

  assert.deepEqual(
    resolveCommitMessagePromptOptions(
      {
        version: 1,
        workbench: { git: { commitMessage: { style: "conventional" } } }
      },
      panel
    ),
    {
      style: "conventional",
      customInstructions: "Use release-note style."
    }
  );

  assert.deepEqual(
    resolveCommitMessagePromptOptions(
      {
        version: 1,
        workbench: {
          git: {
            commitMessage: {
              style: "conventional",
              extraInstructions: "scope must be a package name"
            }
          }
        }
      },
      panel
    ),
    {
      style: "conventional",
      customInstructions: "Use release-note style.",
      extraInstructions: "scope must be a package name"
    }
  );

  assert.deepEqual(
    resolveCommitMessagePromptOptions(
      {
        version: 1,
        im: {},
        workbench: {
          git: {
            commitMessage: {
              style: "custom",
              customInstructions: "Use ticket IDs."
            }
          }
        }
      },
      panel
    ),
    {
      style: "custom",
      customInstructions: "Use ticket IDs."
    }
  );
});
