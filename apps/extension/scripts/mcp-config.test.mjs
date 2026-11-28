import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildAgentSelfInstallPrompt,
  detectMcpClients,
  readRegisteredMcpSpec,
  removeMcpClientConfig,
  upsertMcpClientConfig
} from "../out/mcp/configWriters.js";
import { probeMcpStdioServer } from "../out/mcp/probeMcp.js";

test("MCP config writers register, detect, and remove across all supported agents", () => {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "agent-resume-mcp-cfg-"));
  try {
    fs.mkdirSync(path.join(tmpHome, ".codex"), { recursive: true });
    fs.mkdirSync(path.join(tmpHome, ".cursor"), { recursive: true });
    fs.mkdirSync(path.join(tmpHome, ".gemini", "config"), { recursive: true });
    fs.mkdirSync(path.join(tmpHome, ".config", "opencode"), { recursive: true });
    fs.mkdirSync(path.join(tmpHome, ".grok"), { recursive: true });
    fs.mkdirSync(path.join(tmpHome, ".pi", "agent"), { recursive: true });
    fs.mkdirSync(path.join(tmpHome, ".prime", "agent"), { recursive: true });
    fs.mkdirSync(path.join(tmpHome, ".omp", "agent"), { recursive: true });
    fs.mkdirSync(path.join(tmpHome, ".config", "alma"), { recursive: true });

    fs.writeFileSync(
      path.join(tmpHome, ".claude.json"),
      JSON.stringify({ otherSetting: true, mcpServers: { existing: { command: "foo" } } }, null, 2),
      "utf8"
    );
    fs.writeFileSync(
      path.join(tmpHome, ".codex", "config.toml"),
      'model = "gpt-5"\n\n[mcp_servers.other]\ncommand = "bar"\n',
      "utf8"
    );
    fs.writeFileSync(
      path.join(tmpHome, ".config", "opencode", "opencode.json"),
      JSON.stringify({ $schema: "https://opencode.ai/config.json", mcp: { other: { type: "local", command: ["echo"] } } }, null, 2),
      "utf8"
    );
    fs.writeFileSync(
      path.join(tmpHome, ".prime", "agent", "settings.json"),
      JSON.stringify({ defaultModel: "claude-sonnet" }, null, 2),
      "utf8"
    );

    const env = {
      homeDir: tmpHome,
      platform: "darwin",
      xdgConfigHome: path.join(tmpHome, ".config")
    };
    let clients = detectMcpClients(env);
    for (const id of ["claude", "codex", "antigravity", "cursor", "opencode", "grok", "pi", "prime", "omp", "alma"]) {
      const client = clients.find((c) => c.id === id);
      assert.ok(client, `expected client ${id}`);
      assert.equal(client.installed, true, `${id} should be detected`);
      assert.equal(client.registered, false, `${id} should start unregistered`);
    }

    const spec = {
      command: "node",
      args: ["/Users/demo/.agent-resume-panel/bin/agent-resume-mcp.cjs"],
      env: { AGENT_RESUME_PANEL_HOME: "/custom/panel" }
    };

    for (const id of ["claude", "codex", "antigravity", "opencode", "grok", "pi", "prime", "omp", "alma", "vscode"]) {
      const client = clients.find((c) => c.id === id);
      upsertMcpClientConfig(client, spec);
    }

    clients = detectMcpClients(env);
    for (const id of ["claude", "codex", "antigravity", "opencode", "grok", "pi", "prime", "omp", "alma", "vscode"]) {
      assert.equal(clients.find((c) => c.id === id)?.registered, true, `${id} should be registered`);
    }

    // Verify OpenCode format (`mcp` + array `command` + `environment`)
    const opencodeJson = JSON.parse(
      fs.readFileSync(path.join(tmpHome, ".config", "opencode", "opencode.json"), "utf8")
    );
    assert.deepEqual(opencodeJson.mcp.other, { type: "local", command: ["echo"] });
    assert.deepEqual(opencodeJson.mcp["agent-resume"], {
      type: "local",
      command: ["node", "/Users/demo/.agent-resume-panel/bin/agent-resume-mcp.cjs"],
      enabled: true,
      environment: { AGENT_RESUME_PANEL_HOME: "/custom/panel" }
    });

    // Verify Prime Agent preserved existing settings.json fields
    const primeJson = JSON.parse(
      fs.readFileSync(path.join(tmpHome, ".prime", "agent", "settings.json"), "utf8")
    );
    assert.equal(primeJson.defaultModel, "claude-sonnet");
    assert.ok(primeJson.mcpServers["agent-resume"]);

    // Verify Antigravity wrote ~/.gemini/config/mcp_config.json
    const agyJson = JSON.parse(
      fs.readFileSync(path.join(tmpHome, ".gemini", "config", "mcp_config.json"), "utf8")
    );
    assert.ok(agyJson.mcpServers["agent-resume"]);

    // Verify Grok Build TOML
    const grokToml = fs.readFileSync(path.join(tmpHome, ".grok", "config.toml"), "utf8");
    assert.match(grokToml, /\[mcp_servers\.agent-resume\]/);
    assert.match(grokToml, /AGENT_RESUME_PANEL_HOME = "\/custom\/panel"/);

    // Verify Agent self-install prompt contains all key info
    const prompt = buildAgentSelfInstallPrompt(spec, env);
    assert.match(prompt, /agent-resume-mcp\.cjs/);
    assert.match(prompt, /OpenCode/);
    assert.match(prompt, /Grok Build/);
    assert.match(prompt, /Prime Agent/);
    assert.match(prompt, /search_agent_resume/);

    // Verify readRegisteredMcpSpec reads back exact command/args/env for JSON, OpenCode, and TOML
    const claudeSpec = readRegisteredMcpSpec(clients.find((c) => c.id === "claude"));
    assert.deepEqual(claudeSpec, spec);
    const openCodeSpec = readRegisteredMcpSpec(clients.find((c) => c.id === "opencode"));
    assert.deepEqual(openCodeSpec, spec);
    const codexSpec = readRegisteredMcpSpec(clients.find((c) => c.id === "codex"));
    assert.deepEqual(codexSpec, spec);
    const almaSpec = readRegisteredMcpSpec(clients.find((c) => c.id === "alma"));
    assert.deepEqual(almaSpec, spec);

    // Verify clean removal
    for (const id of ["claude", "codex", "antigravity", "opencode", "grok", "pi", "prime", "omp", "alma", "vscode"]) {
      assert.equal(removeMcpClientConfig(clients.find((c) => c.id === id)), true);
    }
    clients = detectMcpClients(env);
    for (const id of ["claude", "codex", "antigravity", "opencode", "grok", "pi", "prime", "omp", "alma", "vscode"]) {
      assert.equal(clients.find((c) => c.id === id)?.registered, false, `${id} should be unregistered`);
    }
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

test("probeMcpStdioServer verifies live MCP handshake and tools list", async () => {
  const bundlePath = path.resolve(
    import.meta.dirname,
    "..",
    "..",
    "..",
    "packages",
    "mcp",
    "dist",
    "agent-resume-mcp.cjs"
  );
  const res = await probeMcpStdioServer({
    command: process.execPath,
    args: [bundlePath]
  });
  assert.equal(res.ok, true, res.error);
  assert.deepEqual([...res.tools].sort(), [
    "get_session",
    "list_notes",
    "list_projects",
    "list_sessions",
    "read_note",
    "search_agent_resume"
  ]);
});
