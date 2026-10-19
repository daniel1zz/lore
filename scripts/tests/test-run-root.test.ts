// @spawns vitest.node.config.ts
// @spawns packages/lore/tests/unit/core/global-config.test.ts
// @spawns packages/lore/tests/unit/adapters/http/auth-routes.bun.test.ts
// @spawns packages/lore/tests/integration/hooks/stop-turn-review-cursor.test.ts
// @spawns packages/lore/tests/unit/hooks/session-bootstrap-injection.test.ts
// @spawns packages/lore/tests/unit/adapters/real-process-scan-port.test.ts
// @spawns packages/lore/tests/unit/service/setup-service.test.ts
/**
 * One run root per test run (plan-test-runs-own-their-temp-dir-one-run-root-holds-home-and, D1-D3; AS-27).
 *
 * The oracle measures in a fresh mkdtemp TMPDIR that it points the spawned vitest runs at, so the user temp dir is
 * never read or deleted here. Cases:
 *   - a representative selection under the Bun runtime and under Node leaves no lore-* / turn-* entry and an empty
 *     lore-test-runs/ (the tests keep calling mkdtemp(tmpdir()) unchanged; nothing is removed per test);
 *   - a root whose owner pid is alive survives another run; a root whose owner was SIGKILLed is removed by the next run;
 *   - a nested run (marker inherited from its parent) creates no root and removes nothing of its parent's.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = resolve(__dirname, "../..");
const MARKER = "LORE_TEST_THROWAWAY_HOME";
const RUN_TIMEOUT_MS = 240_000;

const BUN_SELECTION = [
  "packages/lore/tests/unit/core/global-config.test.ts",
  "packages/lore/tests/unit/adapters/http/auth-routes.bun.test.ts",
  "packages/lore/tests/integration/hooks/stop-turn-review-cursor.test.ts",
];
const NODE_SELECTION = [
  "packages/lore/tests/unit/hooks/session-bootstrap-injection.test.ts",
  "packages/lore/tests/unit/adapters/real-process-scan-port.test.ts",
  "packages/lore/tests/unit/service/setup-service.test.ts",
];
const ARM_SCRIPT = `import "./vitest.shared.ts"; console.log("ROOT_HOME=" + process.env.${MARKER}); setInterval(() => undefined, 1000);`;

const scratch: string[] = [];
const children: ChildProcess[] = [];
afterEach(() => {
  for (const c of children.splice(0)) c.kill("SIGKILL");
  for (const d of scratch.splice(0)) rmSync(d, { recursive: true, force: true });
});

function freshTmp(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "run-root-oracle-")));
  scratch.push(dir);
  return dir;
}

/** The environment of an OUTER run: the nested-run marker removed, every temp variable pointing at `tmp`. */
function outerEnv(tmp: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, TMPDIR: tmp, TMP: tmp, TEMP: tmp, NO_COLOR: "1" };
  delete env["FORCE_COLOR"];
  delete env[MARKER];
  return { ...env, ...extra };
}

function runVitest(runtime: "bun" | "node", files: readonly string[], tmp: string): { status: number | null; output: string } {
  const args = runtime === "bun" ? ["--bun", "vitest", "run", ...files] : ["vitest", "run", "-c", "vitest.node.config.ts", ...files];
  const r = spawnSync("bunx", args, { cwd: REPO_ROOT, env: outerEnv(tmp), encoding: "utf8", timeout: RUN_TIMEOUT_MS });
  return { status: r.status, output: `${r.stdout}\n${r.stderr}` };
}

function leaked(tmp: string): string[] {
  return readdirSync(tmp).filter((n) => /^(lore-|turn-)/.test(n) && n !== "lore-test-runs");
}

function rootsLeft(tmp: string): string[] {
  const dir = join(tmp, "lore-test-runs");
  return existsSync(dir) ? readdirSync(dir) : [];
}

/** Starts a process that loads the run config (arming a root) and stays alive; resolves with its root. */
async function startArmedRun(tmp: string, extra: Record<string, string> = {}): Promise<{ child: ChildProcess; home: string }> {
  const child = spawn("bun", ["-e", ARM_SCRIPT], { cwd: REPO_ROOT, env: outerEnv(tmp, extra), stdio: ["ignore", "pipe", "inherit"] });
  children.push(child);
  const home = await new Promise<string>((res, rej) => {
    let buf = "";
    child.stdout!.on("data", (d: Buffer) => {
      buf += d.toString();
      const m = /ROOT_HOME=(.*)\n/.exec(buf);
      if (m !== null) res(m[1]!);
    });
    child.once("exit", (code) => rej(new Error(`armed run exited ${String(code)} before printing its root: ${buf}`)));
  });
  return { child, home };
}

async function waitExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((res) => child.once("exit", () => res()));
}

describe("one run root per test run", () => {
  it("the Bun-runtime selection leaves no lore-*/turn-* entry and an empty lore-test-runs/", () => {
    const tmp = freshTmp();
    const r = runVitest("bun", BUN_SELECTION, tmp);
    expect(r.status, r.output.slice(-3000)).toBe(0);
    expect(r.output).toMatch(/Test Files\s+3 passed/);
    expect(leaked(tmp)).toEqual([]);
    expect(rootsLeft(tmp)).toEqual([]);
  }, RUN_TIMEOUT_MS + 10_000);

  it("the Node selection leaves no lore-*/turn-* entry and an empty lore-test-runs/", () => {
    const tmp = freshTmp();
    const r = runVitest("node", NODE_SELECTION, tmp);
    expect(r.status, r.output.slice(-3000)).toBe(0);
    expect(r.output).toMatch(/Test Files\s+3 passed/);
    expect(leaked(tmp)).toEqual([]);
    expect(rootsLeft(tmp)).toEqual([]);
  }, RUN_TIMEOUT_MS + 10_000);

  it("a run's HOME and TMPDIR sit under its own root inside the original temp dir", async () => {
    const tmp = freshTmp();
    const { child, home } = await startArmedRun(tmp);
    const root = dirname(home);
    expect(dirname(root)).toBe(join(tmp, "lore-test-runs"));
    expect(root.split("/").pop()).toMatch(new RegExp(`^${String(child.pid)}-`));
    expect(home).toBe(join(root, "home"));
    expect(existsSync(join(root, "tmp"))).toBe(true);
    child.kill("SIGTERM");
    await waitExit(child);
    expect(rootsLeft(tmp)).toEqual([]);
  }, 60_000);

  it("a root whose pid is alive is kept by another run; a SIGKILLed run's root is removed by the next run", async () => {
    const tmp = freshTmp();
    const live = await startArmedRun(tmp);
    const liveRoot = dirname(live.home);
    expect(dirname(liveRoot)).toBe(join(tmp, "lore-test-runs"));

    const during = runVitest("bun", [BUN_SELECTION[0]!], tmp);
    expect(during.status, during.output.slice(-3000)).toBe(0);
    expect(existsSync(liveRoot)).toBe(true);

    live.child.kill("SIGKILL");
    await waitExit(live.child);
    expect(existsSync(liveRoot)).toBe(true);

    const after = runVitest("bun", [BUN_SELECTION[0]!], tmp);
    expect(after.status, after.output.slice(-3000)).toBe(0);
    expect(rootsLeft(tmp)).toEqual([]);
  }, RUN_TIMEOUT_MS * 2 + 30_000);

  it("a nested run reuses its parent's root and removes nothing of it", async () => {
    const tmp = freshTmp();
    const parentRoot = join(tmp, "lore-test-runs", "1-parent");
    mkdirSync(join(parentRoot, "home"), { recursive: true });
    const { child, home } = await startArmedRun(tmp, { [MARKER]: join(parentRoot, "home") });
    expect(home).toBe(join(parentRoot, "home"));
    child.kill("SIGTERM");
    await waitExit(child);
    expect(existsSync(join(parentRoot, "home"))).toBe(true);
  }, 60_000);
});
