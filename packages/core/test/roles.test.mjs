import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import {
  discoverProjectRoles,
  parseRoleMarkdown
} from "../dist/index.js";

test("parseRoleMarkdown extracts full YAML frontmatter and body", () => {
  const content = `---
name: DBA Expert
agent: pi
model: deepseek-reasoner
thoughtLevel: high
permissions: write
tools:
  fsWrite: true
  execute: true
callable:
  - Developer
  - role_tester
autoDispatch: true
enabled: true
---
# Persona
You are the Database Administrator (DBA) for this repository.
Analyze SQL migrations and database schema designs.
`;
  const result = parseRoleMarkdown(content, { fileName: "dba-expert.md" });

  assert.equal(result.slug, "dba-expert");
  assert.equal(result.name, "DBA Expert");
  assert.equal(result.agent, "pi");
  assert.equal(result.model, "deepseek-reasoner");
  assert.equal(result.thoughtLevel, "high");
  assert.equal(result.permissions, "write");
  assert.deepEqual(result.tools, { fsRead: true, fsWrite: true, execute: true });
  assert.deepEqual(result.callable, ["Developer", "role_tester"]);
  assert.equal(result.autoDispatch, true);
  assert.equal(result.enabled, true);
  assert.ok(result.persona.includes("You are the Database Administrator (DBA)"));
});

test("parseRoleMarkdown handles inline array callable and fallback values", () => {
  const content = `---
callable: [Developer, role_architect, UI Designer]
auto_dispatch: false
---
You are a specialized code reviewer.
`;
  const result = parseRoleMarkdown(content, { fileName: "code_reviewer.md" });

  assert.equal(result.slug, "code-reviewer");
  assert.equal(result.name, "Code Reviewer");
  assert.equal(result.agent, "claude");
  assert.equal(result.model, undefined);
  assert.equal(result.permissions, "read");
  assert.deepEqual(result.tools, { fsRead: true, fsWrite: false, execute: false });
  assert.deepEqual(result.callable, ["Developer", "role_architect", "UI Designer"]);
  assert.equal(result.autoDispatch, false);
  assert.equal(result.enabled, true);
  assert.ok(result.persona.includes("You are a specialized code reviewer."));
});

test("parseRoleMarkdown falls back cleanly when no frontmatter is provided", () => {
  const content = `You are a security auditor inspecting dependency vulnerabilities and API tokens.`;
  const result = parseRoleMarkdown(content, { fileName: "security-auditor.md" });

  assert.equal(result.slug, "security-auditor");
  assert.equal(result.name, "Security Auditor");
  assert.equal(result.agent, "claude");
  assert.equal(result.permissions, "read");
  assert.deepEqual(result.tools, { fsRead: true, fsWrite: false, execute: false });
  assert.deepEqual(result.callable, []);
  assert.equal(result.autoDispatch, false);
  assert.equal(result.persona, content);
});

test("discoverProjectRoles scans .arp/roles/*.md and returns descriptors", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "roles-test-"));
  const projectPath = path.join(tmpDir, "project");
  const rolesDir = path.join(projectPath, ".arp", "roles");
  await fs.mkdir(rolesDir, { recursive: true });

  // 1. Create role A (DBA)
  await fs.writeFile(
    path.join(rolesDir, "dba.md"),
    `---
name: DBA Specialist
agent: pi
callable:
  - Developer
---
You are DBA.`
  );

  // 2. Create role B (Security)
  await fs.writeFile(
    path.join(rolesDir, "security.md"),
    `---
name: Security Analyst
agent: codex
tools:
  fsWrite: true
---
You are Security.`
  );

  // 3. Create non-markdown file (should be ignored)
  await fs.writeFile(path.join(rolesDir, "README.txt"), "This is not a role file.");

  try {
    const roles = await discoverProjectRoles({ projectPath });
    assert.equal(roles.length, 2);

    const dba = roles.find((r) => r.slug === "dba");
    assert.ok(dba);
    assert.equal(dba.id, "project_role_dba");
    assert.equal(dba.name, "DBA Specialist");
    assert.equal(dba.agent, "pi");
    assert.deepEqual(dba.callable, ["Developer"]);

    const security = roles.find((r) => r.slug === "security");
    assert.ok(security);
    assert.equal(security.id, "project_role_security");
    assert.equal(security.name, "Security Analyst");
    assert.equal(security.agent, "codex");
    assert.equal(security.tools.fsWrite, true);
    assert.equal(security.permissions, "write");
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test("discoverProjectRoles handles missing directory and empty options", async () => {
  const nonExistent = path.join(os.tmpdir(), "non-existent-roles-path-12345");
  const result1 = await discoverProjectRoles({ projectPath: nonExistent });
  assert.deepEqual(result1, []);

  const result2 = await discoverProjectRoles({});
  assert.deepEqual(result2, []);
});
