/**
 * Phase 1 实证（v3）：分离「瞬态启动进程 / 常驻基础设施 / 真实工具执行」。
 *
 * v2 发现朴素判据 descendants>1 被证伪：
 *   pi 空闲 = 7 个后代，claude 空闲 = 3 个后代。
 * 其中包含 Agent Resume 自身的 MCP bridge 与启动期的 npm update 检查。
 *
 * 本实验的结论最终被 stage 3 取代：不再推断后代，而是直接问内核「这个终端的前台
 * 进程组是哪个」（见 `agentStatus/processTable.ts` 与
 * `process-foreground-baseline.mjs`）。保留此脚本仅用于观察进程树如何演化。
 *
 * 本实验对 pi / claude 空闲态做时序采样，观察进程树如何演化，
 * 以区分：
 *   - 瞬态：启动期 update 检查（会自行消失）
 *   - 常驻：MCP bridge / language server（长期存在）
 *   - 工具：agent 执行命令时产生的进程（我们要检测的目标）
 */

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pty = require("node-pty");

function readProcessTable() {
  const out = execFileSync("ps", ["-Ao", "pid=,ppid=,comm=,etime="], { encoding: "utf8" });
  const table = new Map();
  for (const line of out.split("\n")) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.*?)\s+(\S+)$/);
    if (!m) continue;
    table.set(Number(m[1]), { ppid: Number(m[2]), command: m[3], etime: m[4] });
  }
  return table;
}

function collectDescendants(table, rootPid) {
  const children = new Map();
  for (const [pid, info] of table) {
    if (!children.has(info.ppid)) children.set(info.ppid, []);
    children.get(info.ppid).push(pid);
  }
  const direct = children.get(rootPid) ?? [];
  const all = [];
  const queue = [...direct];
  while (queue.length) {
    const pid = queue.shift();
    all.push(pid);
    for (const child of children.get(pid) ?? []) queue.push(child);
  }
  return { direct, all };
}

/** 取可执行文件名并去掉 node-pty 包装后的括号噪声。 */
const shortName = (table, pid) => {
  const info = table.get(pid);
  if (!info) return `?`;
  const base = info.command.split("/").pop() ?? info.command;
  return base.replace(/[()]/g, "");
};

function spawnLikePtyHost(command) {
  const shell = process.env.SHELL || "/bin/zsh";
  return pty.spawn(shell, ["-ilc", `${command}; exec ${shell} -il`], {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    cwd: process.cwd(),
    env: { ...process.env, TERM: "xterm-256color" }
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 在多个时间点采样同一进程，追踪后代集合的演化。 */
async function traceOverTime(label, command, marks) {
  console.log(`\n【${label}】`);
  const proc = spawnLikePtyHost(command);
  const started = Date.now();
  const seen = new Map(); // name -> {firstSeenMs, lastSeenMs, count}

  for (const mark of marks) {
    await sleep(Math.max(0, mark - (Date.now() - started)));
    const table = readProcessTable();
    const { all } = collectDescendants(table, proc.pid);
    const names = all.map((pid) => shortName(table, pid));

    console.log(`  t=${String(mark).padStart(5)}ms  后代=${String(all.length).padStart(2)}  [${names.join(", ")}]`);

    for (const n of names) {
      const rec = seen.get(n);
      if (rec) {
        rec.lastSeenMs = mark;
        rec.count += 1;
      } else {
        seen.set(n, { firstSeenMs: mark, lastSeenMs: mark, count: 1 });
      }
    }
  }

  // 稳态时刻的最后一次采样决定分类
  const table = readProcessTable();
  const { all } = collectDescendants(table, proc.pid);
  const steadyNames = new Set(all.map((pid) => shortName(table, pid)));

  console.log(`  ── 分类 ──`);
  for (const [n, rec] of seen) {
    const transient = rec.lastSeenMs < marks[marks.length - 1];
    const resident = steadyNames.has(n);
    const kind = transient && !resident ? "瞬态（会消失）" : "常驻（需过滤）";
    console.log(`     ${n.padEnd(24)} 首次=${rec.firstSeenMs}ms 末次=${rec.lastSeenMs}ms  ${kind}`);
  }
  console.log(`  → 稳态后代数量 = ${steadyNames.size}`);

  proc.kill();
  await sleep(600);
  return steadyNames;
}

console.log("═".repeat(76));
console.log("追踪 pi 空闲态的进程树演化（识别瞬态 vs 常驻）");
console.log("═".repeat(76));
const piSteady = await traceOverTime("pi --no-session -nt", "pi --no-session -nt", [1500, 3000, 6000, 10000, 15000]);

console.log("\n" + "═".repeat(76));
console.log("追踪 claude 空闲态的进程树演化");
console.log("═".repeat(76));
const claudeSteady = await traceOverTime("claude", "claude", [1500, 3000, 6000, 10000, 15000]);

console.log("\n" + "═".repeat(76));
console.log("追踪 codex 空闲态的进程树演化");
console.log("═".repeat(76));
const codexSteady = await traceOverTime("codex", "codex", [1500, 3000, 6000, 10000, 15000]);

console.log("\n" + "═".repeat(76));
console.log("稳态汇总（空闲时长期存在的后代，必须在检测中过滤）");
console.log("═".repeat(76));
console.log(`  pi     稳态后代 (${piSteady.size}): ${[...piSteady].join(", ") || "(无)"}`);
console.log(`  claude 稳态后代 (${claudeSteady.size}): ${[...claudeSteady].join(", ") || "(无)"}`);
console.log(`  codex  稳态后代 (${codexSteady.size}): ${[...codexSteady].join(", ") || "(无)"}`);

process.exit(0);
