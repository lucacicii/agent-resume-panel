import { createMacDmg, packMacApp, runDesktopBuild } from "./mac-app.mjs";

runDesktopBuild();
const appBundle = await packMacApp();
const dmgPath = createMacDmg(appBundle);
console.log(`\nPackaged: ${appBundle}`);
console.log(`DMG: ${dmgPath}`);