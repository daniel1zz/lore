/**
 * Recorded child_process module (alias target for `child_process` / `node:child_process`).
 * Purpose: the vite alias target that lets scripts/test-read-log.ts see every path a test passes to
 * this module (task-skill-implement-tg-13, AC-TG-7). Public surface: every named export of the real
 * module (Node and Bun union, checked by scripts/tests/test-read-aliases.test.ts) plus `default`.
 * Side-effect class: records into the per-worker event log, then delegates unchanged.
 * Do not hand-edit the export list: regenerate it from `Object.keys(require("node:child_process"))` on Node and Bun.
 */
import { createRequire } from "node:module";
import { wrapChildProcessModule } from "./test-read-log";

// reason: `createRequire` reaches the REAL module; importing "node:child_process" here would resolve to this file.
const real = createRequire(import.meta.url)("node:child_process") as typeof import("node:child_process");
// reason: typed loosely on purpose - the export list is the union of Node and Bun names, which no single @types/node version declares.
const recorded = wrapChildProcessModule(real) as unknown as Record<string, unknown>;

export default recorded;
export const ChildProcess = recorded.ChildProcess;
export const exec = recorded.exec;
export const execFile = recorded.execFile;
export const execFileSync = recorded.execFileSync;
export const execSync = recorded.execSync;
export const fork = recorded.fork;
export const spawn = recorded.spawn;
export const spawnSync = recorded.spawnSync;
