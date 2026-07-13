import { createMacDmg, packMacApp, runDesktopBuild } from "./mac-app.mjs";

runDesktopBuild();
const appBundle = packMacApp();
const dmgPath = createMacDmg(appBundle);
console.log(`\nPackaged: ${appBundle}`);
console.log(`DMG: ${dmgPath}`);