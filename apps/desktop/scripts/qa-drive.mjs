/**
 * Visual QA driver: run an expression in a page, open windows, and report the
 * computed design tokens. Usage:
 *   node scripts/qa-drive.mjs eval "<js>"
 *   node scripts/qa-drive.mjs open-settings
 *   node scripts/qa-drive.mjs tokens
 *   node scripts/qa-drive.mjs open-workbench
 */
import { chromium } from "playwright";

const [command, arg] = process.argv.slice(2);
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const context = browser.contexts()[0];
const mode = (p) => new URLSearchParams(p.url().split("?")[1] || "").get("mode") || "main";
const wanted = (process.argv.find((value) => value.startsWith("--mode=")) || "--mode=main").slice("--mode=".length);
const board = context.pages().find((p) => mode(p) === wanted) || context.pages()[0];
if (!board) throw new Error(`no page for mode=${wanted}`);
// Playwright defaults colorScheme to light; clear every override so the app is
// observed in its real appearance instead of an emulated one.
await board.emulateMedia({ colorScheme: null, reducedMotion: null, forcedColors: null });

if (command === "eval") {
  console.log(JSON.stringify(await board.evaluate(arg), null, 2));
} else if (command === "eval-file") {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(arg, "utf8");
  console.log(JSON.stringify(await board.evaluate(source), null, 2));
} else if (command === "diagnose") {
  board.on("console", (message) => console.log(`[console:${message.type()}] ${message.text()}`));
  board.on("pageerror", (error) => console.log(`[pageerror] ${error.message}\n${error.stack?.split("\n").slice(0, 6).join("\n")}`));
  board.on("requestfailed", (request) => console.log(`[requestfailed] ${request.url()}`));
  await board.reload();
  await new Promise((r) => setTimeout(r, 4000));
  console.log("reloaded");
} else if (command === "right-click") {
  await board.click(arg, { button: "right" });
  await new Promise((r) => setTimeout(r, 1200));
  console.log(`right-clicked ${arg}`);
} else if (command === "evaluate-dialog") {
  // Fire a native alert from the renderer and leave it open for inspection.
  board.evaluate(() => {
    void window.agentResume.dialogConfirm({
      message: "Delete workbench \"demo\"?",
      detail: "This cannot be undone.",
      confirmLabel: "Delete",
      cancelLabel: "Cancel",
      destructive: true
    });
  }).catch(() => undefined);
  await new Promise((r) => setTimeout(r, 1500));
  console.log("dialog requested");
} else if (command === "open-settings") {
  await board.evaluate(async () => {
    await window.agentResume.openSettingsWindow({ pane: "general" });
  });
  await new Promise((r) => setTimeout(r, 2500));
  console.log("pages:", context.pages().map((p) => `${mode(p)} ${p.url().slice(-40)}`).join(" | "));
} else if (command === "open-workbench") {
  const opened = await board.evaluate(async () => {
    const tasks = await window.agentResume.notesListTasks();
    // Prefer a task that already has a workbench; otherwise create one.
    const all = await window.agentResume.listAllTaskWorkbenches();
    const withWorkbench = tasks.find((task) => all.some((wb) => wb.taskNoteId === task.noteId));
    const target = withWorkbench || tasks[0];
    if (!target) return "no tasks";
    let workbenchId = all.find((wb) => wb.taskNoteId === target.noteId)?.workbenchId;
    if (!workbenchId) {
      const created = await window.agentResume.ensureTaskWorkbench({ noteId: target.noteId });
      workbenchId = created.workbenchId;
    }
    const result = await window.agentResume.taskWindowOpen({
      noteId: target.noteId,
      workbenchId,
      title: target.title || "Task"
    });
    return JSON.stringify({ task: target.title, workbenchId, result });
  });
  await new Promise((r) => setTimeout(r, 6000));
  console.log("opened:", opened);
  console.log("pages:", context.pages().map((p) => mode(p)).join(" | "));
} else if (command === "reduced-transparency") {
  // Verify the Reduce Transparency fallback: solid surfaces, no material gaps.
  const snapshot = () => board.evaluate(() => ({
    matches: window.matchMedia("(prefers-reduced-transparency: reduce)").matches,
    bodyBg: getComputedStyle(document.body).backgroundColor,
    navBg: document.querySelector(".settings-nav") ? getComputedStyle(document.querySelector(".settings-nav")).backgroundColor : "n/a",
    mainBg: document.querySelector(".settings-main") ? getComputedStyle(document.querySelector(".settings-main")).backgroundColor : "n/a",
    topBg: document.querySelector(".top") ? getComputedStyle(document.querySelector(".top")).backgroundColor : "n/a"
  }));
  console.log("normal :", JSON.stringify(await snapshot()));
  try {
    await board.emulateMedia({ reducedTransparency: "reduce" });
    await new Promise((r) => setTimeout(r, 400));
    console.log("reduced:", JSON.stringify(await snapshot()));
    await board.emulateMedia({ reducedTransparency: "no-preference" });
  } catch (error) {
    console.log("unsupported:", error instanceof Error ? error.message.split("\n")[0] : String(error));
  }
} else if (command === "tokens") {
  for (const p of context.pages()) {
    const info = await p.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      const body = getComputedStyle(document.body);
      const grab = (name) => root.getPropertyValue(name).trim();
      return {
        mode: document.documentElement.dataset.windowMode,
        theme: document.documentElement.dataset.theme,
        fullscreen: document.documentElement.dataset.fullscreen || null,
        accentBase: grab("--accent-base") || "(not injected)",
        accent: grab("--color-accent"),
        accentHover: grab("--color-accent-hover"),
        focusRing: grab("--color-focus-ring"),
        fillPrimary: grab("--color-fill-primary"),
        windowBg: grab("--color-window-bg"),
        bodyBackground: body.backgroundColor,
        userSelect: body.userSelect,
        scrollbarWidth: root.getPropertyValue("scrollbar-width").trim() || "(system)",
        cardBg: grab("--color-card-bg"),
        reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
        reducedTransparency: window.matchMedia("(prefers-reduced-transparency: reduce)").matches
      };
    });
    console.log(JSON.stringify(info));
  }
} else {
  console.log("unknown command");
}
await browser.close();
