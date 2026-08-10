import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveModuleSpecifier } from "../dist/linkgraph/resolve.js";

test("resolves @/api/invoice from monorepo vue path", async () => {
  const monorepo = "/Users/me/work/my-app";
  const fromVue =
    "/Users/me/work/my-app/web-app/src/views/report_center/invoice_details/index.vue";
  const resolved = await resolveModuleSpecifier(monorepo, fromVue, "@/api/invoice");
  assert.ok(resolved, "expected resolve");
  assert.match(resolved.absolutePath, /web-app\/src\/api\/invoice\.ts$/);
});
