import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import {
  discoverSkills,
  formatSkillsCatalogPrompt,
  parseSkillFile,
  parseSkillFrontmatter,
  parseSkillMarkdownFallback,
  skillToToolDescriptor
} from "../dist/index.js";

test("parseSkillFrontmatter extracts YAML frontmatter fields", () => {
  const content = `---
name: my-cool-skill
description: Does something awesome
triggers:
  - when user asks for coolness
  - do coolness
---
# Instructions
Step 1: Do cool thing.
`;
  const result = parseSkillFrontmatter(content);
  assert.equal(result.name, "my-cool-skill");
  assert.equal(result.description, "Does something awesome");
  assert.deepEqual(result.triggers, ["when user asks for coolness", "do coolness"]);
  assert.ok(result.rawBody.includes("# Instructions"));
});

test("parseSkillMarkdownFallback extracts header and description when no frontmatter", () => {
  const content = `# Dividend Cows
Search A-share dividend stocks with high yield.

TRIGGER when: User asks about dividend stocks.
`;
  const result = parseSkillMarkdownFallback(content, "default-name");
  assert.equal(result.name, "Dividend Cows");
  assert.ok(result.description.includes("Search A-share"));
  assert.ok(result.triggers?.[0]?.includes("User asks about dividend stocks"));
});

test("discoverSkills finds skills across project and user roots with deduplication", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "skills-test-"));
  const userHome = path.join(tmpDir, "user");
  const projectPath = path.join(tmpDir, "project");

  // Create user skills
  const userSkillDir = path.join(userHome, ".agents", "skills", "global-skill");
  await fs.mkdir(userSkillDir, { recursive: true });
  await fs.writeFile(
    path.join(userSkillDir, "SKILL.md"),
    `---\nname: global-skill\ndescription: Global user skill\n---\nBody`
  );

  // Create project skill (overrides global if same name)
  const projectSkillDir = path.join(projectPath, ".agents", "skills", "global-skill");
  await fs.mkdir(projectSkillDir, { recursive: true });
  await fs.writeFile(
    path.join(projectSkillDir, "SKILL.md"),
    `---\nname: global-skill\ndescription: Overridden project skill\n---\nProject Body`
  );

  // Create project unique skill
  const projUniqueDir = path.join(projectPath, "skills", "local-skill");
  await fs.mkdir(projUniqueDir, { recursive: true });
  await fs.writeFile(
    path.join(projUniqueDir, "skill.md"),
    `# Local Skill\nLocal skill description`
  );

  try {
    const skills = await discoverSkills({
      projectPath,
      userHome
    });

    assert.equal(skills.length, 2);
    const globalSkill = skills.find((s) => s.name === "global-skill");
    assert.ok(globalSkill);
    assert.equal(globalSkill.scope, "project");
    assert.equal(globalSkill.description, "Overridden project skill");

    const localSkill = skills.find((s) => s.name === "Local Skill");
    assert.ok(localSkill);
    assert.equal(localSkill.scope, "project");

    const prompt = formatSkillsCatalogPrompt(skills);
    assert.ok(prompt.includes("<available_skills>"));
    assert.ok(prompt.includes("<name>global-skill</name>"));
    assert.ok(prompt.includes("<name>Local Skill</name>"));

    const toolDesc = skillToToolDescriptor(globalSkill);
    assert.equal(toolDesc.category, "skills");
    assert.equal(toolDesc.id, "skill:global-skill");
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
