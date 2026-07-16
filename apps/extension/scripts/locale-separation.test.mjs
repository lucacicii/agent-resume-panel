#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const extensionRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const desktopRoot = join(extensionRoot, "..", "desktop");

for (const file of readdirSync(join(extensionRoot, "locales")).filter((name) => name.endsWith(".json"))) {
  const locale = JSON.parse(readFileSync(join(extensionRoot, "locales", file), "utf8"));
  for (const key of Object.keys(locale)) {
    assert.ok(!key.startsWith("desktop."), `extension locale ${file} must not contain ${key}`);
  }
}

for (const file of readdirSync(join(desktopRoot, "locales")).filter((name) => name.endsWith(".json"))) {
  const locale = JSON.parse(readFileSync(join(desktopRoot, "locales", file), "utf8"));
  for (const key of Object.keys(locale)) {
    assert.ok(key.startsWith("desktop."), `desktop locale ${file} must only contain desktop.* keys: ${key}`);
  }
}

console.log("locale-separation.test.mjs: all assertions passed");