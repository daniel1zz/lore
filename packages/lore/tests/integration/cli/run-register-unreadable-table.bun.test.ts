// @spawns packages/lore/src/index.ts
// @spawns packages/lore/tests/integration/cli/stub-unreadable-ps.preload.ts
/**
 * @spec_ref AC-RID-1
 *
 * `lore run register --harness-pid <live pid>` when the process table cannot be read (#418): the port throws
 * ProcessTableUnreadableError, the command refuses with exit 4 naming the cause `process-table-unreadable`, and NO run
 * row is written (a run is never registered without its harness).
 *
 * The unreadable table is modelled by a Bun preload (stub-unreadable-ps.preload.ts) that makes every `ps -p` answer
 * exit 0 with empty output; the harness pid is this test process, which `kill(pid, 0)` proves alive.
 *
 * Six dimensions: NEGATIVE/ERROR (refusal exit + cause + nothing registered), REGRESSION + HAPPY control (same command,
 * same preload file, stub off: registers).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const PACKAGE_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");
const PRELOAD = join(PACKAGE_ROOT, "tests", "integration", "cli", "stub-unreadable-ps.preload.ts");
const VALIDATION_EXIT = 4;
const SESSION = "sess-unreadable-0001";
const MAIN = `cc:${SESSION}`;

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

let root: string;
let corpus: string;

function runLore(args: string[], stubPs: boolean): RunResult {
  const proc = Bun.spawnSync(["bun", "--preload", PRELOAD, INDEX_TS, ...args], {
    cwd: corpus,
    env: {
      ...process.env,
      HOME: join(root, "home"),
      XDG_CONFIG_HOME: join(root, "xdg"),
      EDITOR: "true",
      CLAUDECODE: "1",
      LORE_TEST_STUB_PS_EMPTY: stubPs ? "1" : "0",
    },
  });
  return { stdout: proc.stdout.toString(), stderr: proc.stderr.toString(), exitCode: proc.exitCode ?? 1 };
}

const registerWithHarnessPid = (stubPs: boolean): RunResult =>
  runLore(["run", "register", "--harness", "claude-code", "--session", SESSION, "--harness-pid", String(process.pid)], stubPs);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "lore-run-unreadable-"));
  mkdirSync(join(root, "home"), { recursive: true });
  mkdirSync(join(root, "xdg"), { recursive: true });
  corpus = join(root, "corpus");
  mkdirSync(corpus, { recursive: true });
  const init = runLore(["init"], false);
  if (init.exitCode !== 0) throw new Error(`lore init failed: ${init.stderr}`);
});
afterEach(() => {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

describe("lore run register with an unreadable process table (#418)", () => {
  it("ERROR: exits 4 naming process-table-unreadable and registers no run", () => {
    const r = registerWithHarnessPid(true);
    expect(r.exitCode).toBe(VALIDATION_EXIT);
    expect(r.stderr).toContain("process-table-unreadable");
    expect(r.stdout).not.toContain(MAIN);
    expect(r.stderr).not.toContain("registered without a recorded process");
    // no row: `run show` of the would-be id is NOT_FOUND (exit 3)
    expect(runLore(["run", "show", MAIN], false).exitCode).toBe(3);
  }, 120_000);

  it("HAPPY control: the same command with the stub off registers the run with a harness", () => {
    const r = registerWithHarnessPid(false);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe(MAIN);
    expect(runLore(["run", "show", MAIN], false).exitCode).toBe(0);
  }, 120_000);
});
