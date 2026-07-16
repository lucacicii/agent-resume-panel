#!/usr/bin/env node

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const extensionRoot = join(import.meta.dirname, "..");
const desktopRoot = join(extensionRoot, "..", "desktop");
const allowlist = new Set(
  JSON.parse(readFileSync(join(import.meta.dirname, "i18n-translation-allowlist.json"), "utf8")).keys
);

const hasHan = (value) => /[\u4e00-\u9fff]/.test(value);
const hasKana = (value) => /[\u3040-\u30ff]/.test(value);

function loadLocale(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function checkBundle(label, zhPath, enPath, jaPath) {
  const zh = loadLocale(zhPath);
  const en = loadLocale(enPath);
  const ja = loadLocale(jaPath);
  const errors = [];

  for (const key of Object.keys(zh).sort()) {
    const z = zh[key];
    const e = en[key];
    const j = ja[key];

    if (allowlist.has(key)) {
      continue;
    }

    if (hasHan(z) && j === e) {
      errors.push(`${label}: ja untranslated (ja===en): ${key}`);
    }

    if (hasHan(z) && e === z) {
      errors.push(`${label}: en untranslated (en===zh): ${key}`);
    }

    if (!hasHan(z) && z === e && /[A-Za-z]{3,}/.test(z) && !hasHan(j) && j === e) {
      errors.push(`${label}: zh retains English: ${key}`);
    }
  }

  return errors;
}

const errors = [
  ...checkBundle(
    "extension",
    join(extensionRoot, "locales", "zh-cn.json"),
    join(extensionRoot, "locales", "en.json"),
    join(extensionRoot, "locales", "ja.json")
  ),
  ...checkBundle(
    "desktop",
    join(desktopRoot, "locales", "zh-cn.json"),
    join(desktopRoot, "locales", "en.json"),
    join(desktopRoot, "locales", "ja.json")
  )
];

if (errors.length > 0) {
  console.error(`i18n translation check failed (${errors.length} issues):`);
  for (const error of errors.slice(0, 50)) {
    console.error(`  - ${error}`);
  }
  if (errors.length > 50) {
    console.error(`  ... and ${errors.length - 50} more`);
  }
  process.exit(1);
}

console.log("i18n translation check passed (zh-cn baseline, en + ja coverage).");