/**
 * Six-dimension tests for the whole-CLI stdout non-blocking-fd1 truncation fix
 * (SPEC-048 follow-up, task
 * `task-skill-implement-cli-stdout-non-blocking-truncation-fix-writ`) —
 * `packages/lore/src/adapters/cli/stdio-sync.ts`'s `writeAllSync`/
 * `installSyncStdio`.
 *
 * Root cause (see `stdio-sync.ts`'s module header for the full chain): Bun
 * 1.3.10 sets fd 1 to O_NONBLOCK the first time `process.stdout` is
 * getter-accessed in a process (consola, imported transitively by every CLI
 * command via `citty`, does this at import time). Once non-blocking, a
 * single `write(2)` call (console.log OR a one-shot `fs.writeSync`) delivers
 * at most ~64KiB to a reader that hasn't drained yet, silently dropping the
 * remainder when the process exits. `writeAllSync` fixes this with a
 * loop+EAGAIN-retry; `installSyncStdio` wires it onto `console.*`.
 *
 * Two test groups:
 *   1. In-process unit tests (mocked `node:fs.writeSync`) — fast, exercise
 *      the retry/offset/error-propagation logic directly without spawning
 *      any subprocess or touching a real fd.
 *   2. Subprocess integration tests — spawn a REAL `bun` process (either a
 *      tiny probe script calling `writeAllSync` directly, or the actual dev
 *      CLI) through a genuinely slow-draining OS pipe (`{ sleep 1; cat; }`,
 *      the exact mechanism this defect's diagnosis used), proving the fix
 *      holds under the real non-blocking-fd1 condition Bun creates — a
 *      mocked fd can prove the retry LOGIC is correct but cannot prove the
 *      real OS/Bun interaction is fixed.
 *
 * Dimension mapping:
 *   HAPPY:      writeAllSync (real subprocess, real slow pipe) delivers a
 *               >64KiB payload in full (probe script AND the actual
 *               `lore setup --dry-run --json` CLI output, AC-048-D)
 *   NEGATIVE:   writeAllSync propagates a non-EAGAIN error (EPIPE) instead
 *               of silently swallowing it (mocked fs.writeSync)
 *   BOUNDARY:   a payload exactly 1 byte over the 64KiB pipe-buffer size is
 *               still delivered in full through a real slow pipe (proves the
 *               fix engages exactly where the pre-fix defect started, not
 *               just for comfortably-larger payloads)
 *   ERROR:      writeAllSync retries (not throws) on EAGAIN and resumes from
 *               the correct offset after a partial write (mocked fs.writeSync
 *               scripted: EAGAIN throw -> partial write -> completion)
 *   STATE:      installSyncStdio wires console.log/console.error through
 *               writeAllSync to fd 1 / fd 2 respectively, formatting via
 *               node:util.format + trailing newline (mocked fs.writeSync)
 *   REGRESSION: a small (<64KiB) payload through the same real slow pipe is
 *               BYTE-IDENTICAL to the input (the fix must not alter small,
 *               already-working output)
 *
 * @spec_ref AC-048-D; task task-skill-implement-cli-stdout-non-blocking-truncation-fix-writ
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { execSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ─── In-process unit tests: mock node:fs.writeSync ─────────────────────────
// reason: vi.mock hoists and rewrites the module graph for THIS vitest
// process only — the subprocess-based tests below spawn a separate `bun`
// process with its own, unmocked module resolution, so the two groups never
// interfere with each other.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, writeSync: vi.fn(actual.writeSync) };
});

const { writeSync: mockedWriteSync } = await import("node:fs");
const { writeAllSync, installSyncStdio } = await import(
  "../../src/adapters/cli/stdio-sync.js"
);

const writeSyncSpy = vi.mocked(mockedWriteSync);

describe("writeAllSync — in-process retry/error-propagation logic", () => {
  afterEach(() => {
    writeSyncSpy.mockReset();
  });

  it("NEGATIVE: propagates a non-EAGAIN error (EPIPE) instead of swallowing it", () => {
    const epipe = Object.assign(new Error("write EPIPE"), { code: "EPIPE" });
    writeSyncSpy.mockImplementationOnce(() => {
      throw epipe;
    });

    expect(() => writeAllSync(1, "hello")).toThrow(/EPIPE/);
    expect(writeSyncSpy).toHaveBeenCalledTimes(1);
  });

  it("ERROR: retries on EAGAIN (does not throw) and resumes from the correct offset after a partial write", () => {
    let call = 0;
    writeSyncSpy.mockImplementation(
      (_fd: unknown, _buffer: unknown, offset: unknown, length: unknown) => {
        call += 1;
        if (call === 1) {
          throw Object.assign(new Error("EAGAIN"), { code: "EAGAIN" });
        }
        if (call === 2) {
          // Partial write: only 4 of the requested bytes accepted.
          return 4;
        }
        // Final call: accept everything remaining.
        return length as number;
      },
    );

    expect(() => writeAllSync(1, "x".repeat(10))).not.toThrow();
    expect(writeSyncSpy).toHaveBeenCalledTimes(3);

    const calls = writeSyncSpy.mock.calls;
    // Call 1 (throws EAGAIN before writing anything) starts at offset 0.
    expect(calls[0]?.[2]).toBe(0);
    // Call 2 (the retry) also starts at offset 0 — nothing was written yet.
    expect(calls[1]?.[2]).toBe(0);
    // Call 3 resumes at offset 4 — the 4 bytes call 2 actually wrote.
    expect(calls[2]?.[2]).toBe(4);
    expect(calls[2]?.[3]).toBe(6); // 10 total - 4 already written = 6 remaining
  });
});

describe("installSyncStdio — console.* wiring", () => {
  afterEach(() => {
    writeSyncSpy.mockReset();
  });

  it("STATE: console.log routes through writeAllSync to fd 1, util.format-ing args + trailing newline", () => {
    writeSyncSpy.mockImplementation(
      (_fd: unknown, _buffer: unknown, _offset: unknown, length: unknown) =>
        length as number,
    );
    installSyncStdio();

    console.log("hello %s", "world");

    expect(writeSyncSpy).toHaveBeenCalledTimes(1);
    const call = writeSyncSpy.mock.calls[0] as unknown as [number, Buffer];
    const [fd, buffer] = call;
    expect(fd).toBe(1);
    expect(buffer.toString("utf8")).toBe("hello world\n");
  });

  it("STATE: console.error routes through writeAllSync to fd 2", () => {
    writeSyncSpy.mockImplementation(
      (_fd: unknown, _buffer: unknown, _offset: unknown, length: unknown) =>
        length as number,
    );
    installSyncStdio();

    console.error("oops: %d", 42);

    expect(writeSyncSpy).toHaveBeenCalledTimes(1);
    const call = writeSyncSpy.mock.calls[0] as unknown as [number, Buffer];
    const [fd, buffer] = call;
    expect(fd).toBe(2);
    expect(buffer.toString("utf8")).toBe("oops: 42\n");
  });
});

// ─── Subprocess integration tests: real bun process, real slow pipe ────────

const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(
  /\/$/,
  "",
);
const INDEX_TS = join(REPO_ROOT, "packages", "lore", "src", "index.ts");
const STDIO_SYNC_TS = join(
  REPO_ROOT,
  "packages",
  "lore",
  "src",
  "adapters",
  "cli",
  "stdio-sync.ts",
);

/**
 * Resolves `bun` to its ABSOLUTE path via this test runner's own inherited
 * `PATH` (mirrors `tests/integration/cli/setup.test.ts`'s `BUN_BIN`
 * convention — `bunx vitest` runs test files under `node`, not `bun`).
 */
function resolveBunBin(): string {
  const resolved = execSync("command -v bun", { encoding: "utf8" }).trim();
  if (!resolved) {
    throw new Error(
      "cli-stdout-truncation.test.ts: could not resolve the `bun` binary via `command -v bun` — is Bun installed?",
    );
  }
  return resolved;
}

const BUN_BIN = resolveBunBin();

interface PipedResult {
  readonly stdout: string;
  readonly exitCode: number;
}

/**
 * Runs `cmd` through `bash -c` with `pipefail` set, capturing the FULL
 * combined pipeline stdout. Used to reproduce the exact minimal-repro
 * mechanism this defect was diagnosed with: `<producer> | { sleep 1; cat; }`
 * — a genuinely slow OS-pipe reader, not merely a load-dependent flake.
 */
function runPiped(cmd: string): PipedResult {
  const result = spawnSync("bash", ["-c", `set -o pipefail; ${cmd}`], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    timeout: 20_000,
  });
  return {
    stdout: result.stdout ?? "",
    exitCode: result.status ?? 1,
  };
}

const scratchDirs: string[] = [];

function makeScratchDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratchDirs.push(dir);
  return dir;
}

// reason: a tiny bun probe script that forces the EXACT Bun non-blocking-fd1
// side effect (`void process.stdout`) and then calls the real, unmocked
// `writeAllSync` from the actual source file (absolute path — Bun resolves
// `.ts` specifiers directly, same convention `npm-install-simulation.test.ts`
// uses for `.mjs`). Written once to a scratch dir; every subprocess test
// below spawns `bun <probeScript> <size>`.
const probeScratchDir = makeScratchDir("lore-stdio-sync-probe-");
const probeScriptPath = join(probeScratchDir, "probe.mjs");
writeFileSync(
  probeScriptPath,
  [
    `import { writeAllSync } from ${JSON.stringify(STDIO_SYNC_TS)};`,
    "void process.stdout;", // reproduces Bun's non-blocking-fd1 side effect
    "const size = Number(process.argv[2]);",
    'writeAllSync(1, "x".repeat(size));',
  ].join("\n"),
  "utf8",
);

afterEach(() => {
  // no-op: scratch dirs are cleaned up once via the module-level cleanup below
});

// Module-level cleanup (vitest runs this file's teardown when the process exits
// the suite; explicit afterAll avoided in favor of a single top-level describe
// so `probeScratchDir` creation above stays a one-time module-load side effect,
// mirroring `npm-install-simulation.test.ts`'s beforeAll/afterAll shape but
// simplified since there is no expensive build step to share here).
process.on("exit", () => {
  while (scratchDirs.length > 0) {
    const dir = scratchDirs.pop();
    if (dir === undefined) continue;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore cleanup errors on process exit */
    }
  }
});

describe("writeAllSync — real subprocess through a genuinely slow-reader pipe", () => {
  it(
    "HAPPY: a >64KiB payload is delivered IN FULL (pre-fix: silently truncated to 65536 bytes)",
    () => {
      const size = 200_000;
      const result = runPiped(
        `${BUN_BIN} ${probeScriptPath} ${size} | { sleep 1; cat; }`,
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout.length).toBe(size);
      expect(result.stdout).toBe("x".repeat(size));
    },
    15_000,
  );

  it(
    "BOUNDARY: a payload exactly 1 byte over the 64KiB pipe-buffer size is still delivered in full",
    () => {
      const size = 65_537; // 65536 (pipe buffer) + 1
      const result = runPiped(
        `${BUN_BIN} ${probeScriptPath} ${size} | { sleep 1; cat; }`,
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout.length).toBe(size);
    },
    15_000,
  );

  it(
    "REGRESSION: a small (<64KiB) payload through the same slow pipe is byte-identical to the input",
    () => {
      const size = 500;
      const result = runPiped(
        `${BUN_BIN} ${probeScriptPath} ${size} | { sleep 1; cat; }`,
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("x".repeat(size));
    },
    15_000,
  );
});

describe("lore setup --dry-run --json — real CLI, real slow-reader pipe (AC-048-D)", () => {
  it(
    "HAPPY: the full ~135KB JSON payload parses cleanly through a slow-reader pipe (the original AC-048-D failure mode)",
    () => {
      const claudeDir = join(
        makeScratchDir("lore-stdio-sync-setup-"),
        "claude-target",
      );
      const cmd = `${BUN_BIN} run ${INDEX_TS} setup --dry-run --claude-dir ${claudeDir} --json | { sleep 1; cat; }`;
      const result = runPiped(cmd);

      expect(result.exitCode).toBe(0);
      let parsed: { ok: boolean };
      expect(() => {
        parsed = JSON.parse(result.stdout) as { ok: boolean };
      }).not.toThrow();
      expect(parsed!.ok).toBe(true);
    },
    20_000,
  );
});
