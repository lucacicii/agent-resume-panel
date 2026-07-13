import assert from "node:assert/strict";
import { isBuildStampCurrent, macTargetArch } from "./mac-app.mjs";

assert.equal(macTargetArch, "universal");
assert.equal(
  isBuildStampCurrent(JSON.stringify({ version: 1, arch: "universal", sourceMtime: 200 }), 200),
  true
);
assert.equal(
  isBuildStampCurrent(JSON.stringify({ version: 1, arch: "universal", sourceMtime: 199 }), 200),
  false
);
assert.equal(
  isBuildStampCurrent(JSON.stringify({ version: 1, arch: "arm64", sourceMtime: 200 }), 200),
  false
);
assert.equal(isBuildStampCurrent("200", 200), false);
assert.equal(isBuildStampCurrent("invalid", 200), false);

console.log("mac-app.test.mjs: all assertions passed");
