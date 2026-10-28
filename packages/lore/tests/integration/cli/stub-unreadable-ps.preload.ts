/**
 * Bun preload for run-register-unreadable-table.bun.test.ts: makes every `ps -p <pid>` the CLI runs answer exit 0 with
 * EMPTY output (the macOS flake of #418, made permanent) while the pid itself stays alive. Active only when
 * LORE_TEST_STUB_PS_EMPTY=1; every other spawn is the real one.
 */
import { createRequire } from "node:module";

const childProcess = createRequire(import.meta.url)("node:child_process") as typeof import("node:child_process");
const realSpawnSync = childProcess.spawnSync;

if (process.env["LORE_TEST_STUB_PS_EMPTY"] === "1") {
  (childProcess as { spawnSync: unknown }).spawnSync = ((command: string, args?: readonly string[], options?: unknown) => {
    if (/(^|\/)ps$/.test(command) && (args ?? []).includes("-p")) {
      return { status: 0, signal: null, stdout: "", stderr: "", pid: 0, output: [null, "", ""], error: undefined };
    }
    return (realSpawnSync as (...a: unknown[]) => unknown)(command, args, options);
  }) as typeof childProcess.spawnSync;
}
