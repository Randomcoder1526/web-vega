import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import process from "node:process";

const children = [];
let shuttingDown = false;

function runNode(script, args = [], env = {}) {
  const child = spawn(process.execPath, [script, ...args], {
    stdio: "inherit",
    shell: false,
    env: { ...process.env, ...env },
  });

  children.push(child);
  child.on("exit", (code) => {
    if (code && !shuttingDown) shutdown(code);
  });
  child.on("error", (error) => {
    console.error(`Failed to start ${script}:`, error);
    if (!shuttingDown) shutdown(1);
  });
  return child;
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of children) {
    try {
      child.kill();
    } catch {}
  }

  setTimeout(() => process.exit(code), 50).unref();
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

const serverEntry = fileURLToPath(new URL("./index.mjs", import.meta.url));
const viteEntry = fileURLToPath(
  new URL("../node_modules/vite/bin/vite.js", import.meta.url),
);

runNode(serverEntry, [], { PORT: "4174" });
runNode(viteEntry, ["--host", "0.0.0.0", "--port", "1420"]);
