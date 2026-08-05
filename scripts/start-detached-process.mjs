import { openSync } from "node:fs";
import { spawn } from "node:child_process";

const [logPath, command, ...args] = process.argv.slice(2);

if (!logPath || !command) {
  console.error(
    "Uso: node scripts/start-detached-process.mjs <log> <comando> [argumentos...]",
  );
  process.exit(1);
}

const output = openSync(logPath, "a");
const child = spawn(command, args, {
  cwd: process.cwd(),
  detached: true,
  env: process.env,
  stdio: ["ignore", output, output],
});

child.unref();
console.log(child.pid);
