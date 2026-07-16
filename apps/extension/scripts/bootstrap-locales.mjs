#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const localesDir = join(root, "locales");
const en = JSON.parse(readFileSync(join(localesDir, "en.json"), "utf8"));

const targets = ["zh-cn", "ja", "ko", "es", "fr", "de", "pt-br", "it", "ru"];

for (const locale of targets) {
  const outPath = join(localesDir, `${locale}.json`);
  if (existsSync(outPath)) {
    const existing = JSON.parse(readFileSync(outPath, "utf8"));
    const merged = { ...en };
    for (const [key, value] of Object.entries(existing)) {
      if (key in en) {
        merged[key] = value;
      }
    }
    writeFileSync(outPath, `${JSON.stringify(merged, null, 2)}\n`);
    console.log(`Merged ${locale}.json (${Object.keys(merged).length} keys)`);
    continue;
  }
  writeFileSync(outPath, `${JSON.stringify(en, null, 2)}\n`);
  console.log(`Created ${locale}.json from en.json`);
}