// @spawns packages/lore/src/index.ts
/**
 * D29 — `lore dashboard` reports an unreadable machine config and survives a missing browser opener.
 * Every run uses a throwaway corpus, a temp HOME/config dir and an ephemeral port; no real browser is opened.
 * The CLI runs from source with `LORE_DASHBOARD_ASSETS_FIXTURE=1` (hermetic "assets available" seam).
 *
 * @spec_ref spec-defect-clusters-round-2-part-d-store-selection-runs
 */

import { afterAll, describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openBrowser, type BrowserOpenerChild } from "../../src/adapters/cli/commands/dashboard";

const SPEC = "spec-defect-clusters-round-2-part-d-store-selection-runs";
const INDEX_TS = join(new URL("../../", import.meta.url).pathname, "src", "index.ts");

interface Fixture {
  readonly root: string;
  readonly corpus: string;
  readonly configDir: string;
  readonly emptyBin: string;
  readonly env: Record<string, string>;
}

const roots: string[] = [];
const children: Array<{ kill: (sig?: number) => void }> = [];
afterAll(() => {
  for (const child of children) {
    try {
      child.kill();
    } catch {
      /* already gone */
    }
  }
  for (const root of roots) {
    try {
      chmodSync(join(root, "config", "config.yaml"), 0o600);
    } catch {
      /* no config file */
    }
    rmSync(root, { recursive: true, force: true });
  }
});

function ephemeralPort(): number {
  const listener = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
  const port = listener.port;
  listener.stop(true);
  return port;
}

function makeFixture(): Fixture {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "lore-dc2-dashboard-")));
  roots.push(root);
  const corpus = join(root, "corpus");
  const configDir = join(root, "config");
  const emptyBin = join(root, "empty-bin");
  for (const d of [corpus, configDir, emptyBin, join(root, "state")]) mkdirSync(d, { recursive: true });
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  for (const k of ["XDG_CONFIG_HOME", "LORE_CONFIG_HOME", "CLAUDE_CONFIG_DIR"]) delete env[k];
  Object.assign(env, {
    HOME: corpus,
    LORE_STATE_HOME: join(root, "state"),
    LORE_CONFIG_HOME: configDir,
    LORE_DASHBOARD_ASSETS_FIXTURE: "1",
    CLAUDECODE: "1",
  });
  const init = Bun.spawnSync([process.execPath, INDEX_TS, "init"], { cwd: corpus, env, timeout: 30_000 });
  if (init.exitCode !== 0) throw new Error(`harness: lore init failed: ${init.stderr.toString()}`);
  return { root, corpus, configDir, emptyBin, env };
}

/** Starts `lore dashboard` from source and collects its output until the ready line appears (or timeout). */
async function startDashboard(
  fx: Fixture,
  args: string[],
  envOverride: Record<string, string> = {},
): Promise<{ proc: ReturnType<typeof Bun.spawn>; out: () => { stdout: string; stderr: string }; port: number }> {
  const port = ephemeralPort();
  const proc = Bun.spawn([process.execPath, INDEX_TS, "dashboard", ...args, "--api-port", String(port)], {
    cwd: fx.corpus,
    env: { ...fx.env, ...envOverride },
    stdout: "pipe",
    stderr: "pipe",
  });
  children.push(proc);
  let stdout = "";
  let stderr = "";
  const pump = async (stream: ReadableStream<Uint8Array>, sink: (s: string) => void): Promise<void> => {
    const decoder = new TextDecoder();
    for await (const chunk of stream) sink(decoder.decode(chunk));
  };
  void pump(proc.stdout as ReadableStream<Uint8Array>, (s) => (stdout += s));
  void pump(proc.stderr as ReadableStream<Uint8Array>, (s) => (stderr += s));
  const deadline = Date.now() + 20_000;
  while (!stdout.includes("Dashboard ready") && Date.now() < deadline && proc.exitCode === null) {
    await new Promise((r) => setTimeout(r, 50));
  }
  return { proc, out: () => ({ stdout, stderr }), port };
}

describe(`${SPEC}#AC-DC2-29 (a) unreadable machine config is reported`, () => {
  const isRoot = typeof process.getuid === "function" && process.getuid() === 0;

  it.skipIf(isRoot)(
    `${SPEC}#AC-DC2-29 chmod 000 config: warning names path + cause, registry line says nothing mounted, still serves`,
    async () => {
      const fx = makeFixture();
      const configPath = join(fx.configDir, "config.yaml");
      writeFileSync(configPath, "dashboard:\n  projects: []\n");
      chmodSync(configPath, 0o000);
      const run = await startDashboard(fx, ["--no-open"]);
      const { stdout, stderr } = run.out();
      run.proc.kill();
      expect(stderr).toContain(`Warning: global config ${configPath} ignored`);
      expect(stderr).toMatch(/EACCES|permission denied/i);
      expect(stdout).toContain("no extra projects were mounted");
      expect(stdout).toContain("Dashboard ready");
    },
    60_000,
  );

  it(
    `${SPEC}#AC-DC2-29 missing config prints no warning`,
    async () => {
      const fx = makeFixture();
      const run = await startDashboard(fx, ["--no-open"]);
      const { stdout, stderr } = run.out();
      run.proc.kill();
      expect(stdout).toContain("Dashboard ready");
      expect(stderr).not.toContain("Warning: global config");
      expect(stdout).not.toContain("no extra projects were mounted");
    },
    60_000,
  );
});

describe(`${SPEC}#AC-DC2-29 (b) a browser opener that fails asynchronously keeps the server alive`, () => {
  it(
    `${SPEC}#AC-DC2-29 missing opener binary (async ENOENT): fallback line, process alive 2s later, GET answers 200`,
    async () => {
      const fx = makeFixture();
      // reason: PATH holds only an empty dir, so `open`/`xdg-open` cannot be found and the real spawn emits an
      // async `error` (ENOENT); the server is started by absolute path (process.execPath), so it still launches.
      const run = await startDashboard(fx, [], { PATH: fx.emptyBin });
      const deadline = Date.now() + 10_000;
      while (!run.out().stdout.includes("Could not open browser automatically. Visit: ") && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 50));
      }
      const url = /Could not open browser automatically\. Visit: (\S+)/.exec(run.out().stdout)?.[1];
      expect(url).toBeDefined();
      await new Promise((r) => setTimeout(r, 2000));
      expect(run.proc.exitCode).toBeNull();
      const res = await fetch(`http://localhost:${run.port}/health`);
      run.proc.kill();
      expect(res.status).toBe(200);
    },
    60_000,
  );

  it(`${SPEC}#AC-DC2-29 injected opener emitting an ASYNC error writes the fallback line (not just a sync throw)`, async () => {
    const chunks: string[] = [];
    const io = { stdout: { write: (s: string) => chunks.push(s) } } as never;
    const child = new EventEmitter() as EventEmitter & BrowserOpenerChild;
    openBrowser(io, "/tmp", "http://localhost:1/x", {
      platform: "linux",
      spawnOpener: () => {
        setTimeout(() => child.emit("error", Object.assign(new Error("spawn xdg-open ENOENT"), { code: "ENOENT" })), 10);
        return child;
      },
    });
    expect(chunks.join("")).toBe(""); // nothing synchronously: the failure has not happened yet
    await new Promise((r) => setTimeout(r, 50));
    expect(chunks.join("")).toContain("Could not open browser automatically. Visit: http://localhost:1/x");
  });

  it(`${SPEC}#AC-DC2-29 win32 opener is cmd /c start "" <url>; darwin/linux keep open/xdg-open`, () => {
    const calls: Array<[string, string[]]> = [];
    const io = { stdout: { write: () => undefined } } as never;
    for (const platform of ["win32", "darwin", "linux"] as const) {
      openBrowser(io, "/tmp", "http://localhost:2/", {
        platform,
        spawnOpener: (cmd, args) => {
          calls.push([cmd, args]);
          return new EventEmitter() as EventEmitter & BrowserOpenerChild;
        },
      });
    }
    expect(calls).toEqual([
      ["cmd", ["/c", "start", '""', "http://localhost:2/"]],
      ["open", ["http://localhost:2/"]],
      ["xdg-open", ["http://localhost:2/"]],
    ]);
  });
});
