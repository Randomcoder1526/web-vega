import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../dev.mjs", import.meta.url), "utf8");

assert.equal(
  /shell\s*:\s*process\.platform\s*===\s*["']win32["']/.test(source),
  false,
  "dev runner must not enable shell:true on Windows because Program Files paths are split by cmd.exe",
);

assert.match(
  source,
  /node_modules\/vite\/bin\/vite\.js/,
  "dev runner should launch Vite's JS entry with Node instead of vite.cmd",
);

console.log("dev runner is Windows-safe");
