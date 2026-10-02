import { createMacDmg, macTargetArches, packMacApp, runDesktopBuild } from "./mac-app.mjs";

runDesktopBuild();
const packed = [];
for (const arch of macTargetArches) {
  const result = await packMacApp(arch, { bundleThunder: true });
  const dmgPath = createMacDmg(result.appBundle, arch);
  console.log(`\nPackaged (${arch}): ${result.appBundle}`);
  console.log(`DMG (${arch}): ${dmgPath}`);
  packed.push({ arch, dmgPath, ...result });
}

const withoutDaemon = packed.filter((entry) => !entry.thunderBundled);
if (withoutDaemon.length) {
  // Cannot be missed in the scrollback: these DMGs cannot start Chat out of the box.
  console.warn([
    "",
    "──────────────────────────────────────────────────────────────────────",
    `WARNING: ${withoutDaemon.length} of ${packed.length} DMGs were built WITHOUT the Thunder daemon:`,
    ...withoutDaemon.map((entry) => `  · ${entry.arch}: ${entry.dmgPath}`),
    "Chat in those builds only works on machines that have a thunder checkout or a",
    "configured daemon path. Fix the cause above (see apps/desktop/DEVELOPMENT.md",
    "§ Thunder daemon) or re-run with AGENT_RESUME_REQUIRE_THUNDER=1 to fail instead.",
    "──────────────────────────────────────────────────────────────────────"
  ].join("\n"));
} else {
  console.log(`\nAll ${packed.length} DMGs contain a bundled Thunder daemon (${packed.map((entry) => `${entry.arch}:${entry.thunderSource}`).join(", ")}).`);
}
