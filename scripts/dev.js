import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const children = [];

function start(name, args) {
  const child = spawn(process.execPath, args, { cwd: root, stdio: "inherit" });
  child.on("exit", (code) => {
    if (stopping) return;
    console.log(`[dev] ${name} exited with code ${code ?? 0}`);
    shutdown(code ?? 0);
  });
  children.push(child);
  return child;
}

let stopping = false;
function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    try { child.kill(); } catch {}
  }
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

start("api", [path.join(root, "server", "index.js")]);
start("vite", [path.join(root, "node_modules", "vite", "bin", "vite.js")]);
