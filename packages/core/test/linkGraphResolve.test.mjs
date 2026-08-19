import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { resolveModuleSpecifier } from "../dist/linkgraph/resolve.js";

test("resolves @/api/invoice from monorepo vue path", async () => {
  const monorepo = await mkdtemp(path.join(os.tmpdir(), "linkgraph-"));
  try {
    const pkg = path.join(monorepo, "web-app");
    const vueDir = path.join(pkg, "src/views/report_center/invoice_details");
    const apiDir = path.join(pkg, "src/api");
    await mkdir(vueDir, { recursive: true });
    await mkdir(apiDir, { recursive: true });
    await writeFile(path.join(pkg, "package.json"), "{}\n");
    await writeFile(path.join(vueDir, "index.vue"), "<template></template>\n");
    await writeFile(path.join(apiDir, "invoice.ts"), "export {}\n");

    const fromVue = path.join(vueDir, "index.vue");
    const resolved = await resolveModuleSpecifier(monorepo, fromVue, "@/api/invoice");
    assert.ok(resolved, "expected resolve");
    assert.match(resolved.absolutePath.replaceAll("\\", "/"), /web-app\/src\/api\/invoice\.ts$/);
  } finally {
    await rm(monorepo, { recursive: true, force: true });
  }
});
