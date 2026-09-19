/**
 * Visual QA helper: capture each Electron page through the DevTools protocol.
 *
 * Page screenshots come from the renderer itself, so they do not need the
 * macOS Screen Recording permission. Native surfaces (menu bar, NSMenu popups,
 * alerts) are not part of a page, so those are audited separately through the
 * Accessibility API.
 *
 * IMPORTANT: Playwright defaults `colorScheme` to light. Left alone, every
 * evaluation and screenshot would report an app appearance the user is not
 * looking at — which reads as "the app ignores the system appearance". Pass
 * `--light` / `--dark` to emulate deliberately, or omit both to clear the
 * override and observe the real appearance.
 *
 * Usage: node scripts/qa-capture.mjs <outDir> [--dark|--light]
 */
import { readdirSync, mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const outDir = process.argv[2] || "/tmp/ar-qa";
const theme = process.argv.includes("--dark") ? "dark" : process.argv.includes("--light") ? "light" : null;
mkdirSync(outDir, { recursive: true });

const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const context = browser.contexts()[0];
const pages = context.pages();
console.log(`pages: ${pages.length}`);

let index = 0;
for (const page of pages) {
  index += 1;
  const url = page.url();
  const mode = new URLSearchParams(url.split("?")[1] || "").get("mode") || "main";
  const label = `${index}-${mode}${theme ? `-${theme}` : ""}`;
  try {
    // Emulate the OS appearance instead of poking : the app derives
    // its own appearance from , and Playwright defaults that
    // to light, so an explicit value is what makes the capture honest.
    await page.emulateMedia({ colorScheme: theme || null });
    if (theme) await page.waitForTimeout(500);
    const size = page.viewportSize() || { width: 0, height: 0 };
    await page.screenshot({ path: path.join(outDir, `${label}.png`) });
    console.log(`${label}: ${url.slice(0, 90)} (${size.width}x${size.height})`);
  } catch (error) {
    console.log(`${label}: failed — ${error instanceof Error ? error.message : String(error)}`);
  }
}

// Persist the renderer's own diagnostics: console errors and failed requests.
console.log("files:", readdirSync(outDir).join(", "));
await browser.close();
