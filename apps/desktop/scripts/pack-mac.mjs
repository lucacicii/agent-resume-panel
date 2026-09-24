import { createMacDmg, macTargetArches, packMacApp, runDesktopBuild } from "./mac-app.mjs";

runDesktopBuild();
for (const arch of macTargetArches) {
  const appBundle = await packMacApp(arch, { bundleThunder: true });
  const dmgPath = createMacDmg(appBundle, arch);
  console.log(`\nPackaged (${arch}): ${appBundle}`);
  console.log(`DMG (${arch}): ${dmgPath}`);
}
