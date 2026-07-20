/**
 * @spec_ref BUG-006/007/008/012 audit — unguarded `parseInt(args.<flag>)` calls
 * across `search`/`list`/`log`/`tree`/`diff`/`audit`/`review` CLI commands.
 *
 * Before this fix:
 *   - BUG-006: `search --limit abc` / `list --limit abc` → `parseInt` → `NaN` →
 *     `Array.prototype.slice(0, NaN)` → an ALWAYS-EMPTY result set, exit 0 — an
 *     agent parsing `{results: [], total: 0}` would misread this as "no such
 *     document exists" rather than "the flag value was malformed."
 *   - BUG-007: `log --limit abc` / `diff --from abc` / `audit --limit abc` → NaN
 *     reaches the store's `LIMIT ?` bind and throws a bare, unmapped bun:sqlite
 *     "datatype mismatch" (CLI exit 1, no actionable message).
 *   - BUG-008: `tree --depth abc` → NaN defeats `corpus-service.ts`'s
 *     `remainingDepth <= 0` recursion guard (`NaN <= 0` is always `false`) — the
 *     depth cap silently never triggers.
 *   - BUG-012: `review --staleness --limit -1` → a negative limit reaches
 *     `selectProbeCandidates`'s `.slice(0, -1)` and silently drops the last
 *     candidate from the queue instead of erroring.
 *
 * After this fix, every one of these flags is validated via
 * `adapters/cli/utils.ts::parsePositiveIntArg` BEFORE it can reach a store call
 * or an array slice — a malformed value exits 2 with a stderr message naming the
 * offending flag, mirroring `restore.ts`'s pre-existing `--version` guard and this
 * codebase's SPEC-051 CLI usage-error convention (exit 2).
 *
 * Runs the real CLI via subprocess against an isolated temp SQLite DB — same
 * pattern as `tests/integration/cli/list-paging.test.ts`.
 *
 * Test plan (per command):
 *   NEGATIVE:   non-numeric flag value → exit 2, stderr names the flag
 *   BOUNDARY:   the smallest illegal value just below each flag's floor (0 for
 *               limit/depth flags whose floor is 1; -1 for offset/min-age-days
 *               flags whose floor is 0) → exit 2; the smallest LEGAL value → exit 0
 *   REGRESSION: a normal, valid flag value still produces the pre-existing exit
 *               0 / correct-shaped output
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "child_process";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const PACKAGE_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** Spawn `bun run <INDEX_TS> ...args` in `cwd` with an isolated HOME dir. */
function runLore(args: string[], cwd: string): RunResult {
  const result = spawnSync("bun", ["run", INDEX_TS, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd, EDITOR: "true", CLAUDECODE: "1" },
    encoding: "utf8",
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status ?? 1,
  };
}

let tmpDir: string;
let docId: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `lore-numeric-flags-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });

  const init = runLore(["init"], tmpDir);
  if (init.exitCode !== 0) throw new Error(`lore init failed: ${init.stderr}`);

  const create = runLore(
    ["create", "prd", "--title", "Numeric Flag Fixture PRD", "--no-ai", "--content", "body"],
    tmpDir,
  );
  if (create.exitCode !== 0) throw new Error(`create prd failed: ${create.stderr}`);
  const m = create.stdout.match(/ID:\s+(\S+)/) ?? create.stdout.match(/Slug:\s+(\S+)/);
  const id = m?.[1];
  if (!id) throw new Error(`Could not extract doc id/slug from: ${create.stdout}`);
  docId = id;

  // A second version, so log/diff have something to walk.
  const setResult = runLore(["set", docId, "--content", "updated body v2", "--no-ai"], tmpDir);
  if (setResult.exitCode !== 0) throw new Error(`set failed: ${setResult.stderr}`);
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore cleanup errors */
  }
});

// ─── search --limit (BUG-006) ────────────────────────────────────────────────

describe("lore search --limit", () => {
  it("NEGATIVE: --limit abc exits 2 and names --limit in stderr (not a silent empty result, BUG-006)", () => {
    const result = runLore(["search", "Fixture", "--limit", "abc"], tmpDir);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--limit");
  });

  it("BOUNDARY: --limit 0 exits 2 (floor is 1)", () => {
    const result = runLore(["search", "Fixture", "--limit", "0"], tmpDir);
    expect(result.exitCode).toBe(2);
  });

  it("REGRESSION: --limit 5 (valid) still finds the fixture doc", () => {
    const result = runLore(["search", "Fixture", "--limit", "5", "--json"], tmpDir);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as { data: { total: number } };
    expect(parsed.data.total).toBeGreaterThanOrEqual(1);
  });
});

// ─── list --limit/--offset (BUG-006/007) ─────────────────────────────────────

describe("lore list --limit/--offset", () => {
  it("NEGATIVE: --limit abc exits 2 and names --limit in stderr", () => {
    const result = runLore(["list", "--limit", "abc"], tmpDir);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--limit");
  });

  it("NEGATIVE: --offset -1 exits 2 and names --offset in stderr", () => {
    const result = runLore(["list", "--offset", "-1"], tmpDir);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--offset");
  });

  it("BOUNDARY: --limit 0 is legal for list (a zero-row page request, unlike search/log)", () => {
    const result = runLore(["list", "--limit", "0", "--json"], tmpDir);
    expect(result.exitCode).toBe(0);
  });

  it("REGRESSION: --limit 5 --offset 0 (valid) still lists docs", () => {
    const result = runLore(["list", "--limit", "5", "--offset", "0", "--json"], tmpDir);
    expect(result.exitCode).toBe(0);
  });
});

// ─── log --limit (BUG-007) ────────────────────────────────────────────────────

describe("lore log --limit", () => {
  it("NEGATIVE: --limit abc exits 2 instead of throwing a bare bun:sqlite error (BUG-007)", () => {
    const result = runLore(["log", docId, "--limit", "abc"], tmpDir);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--limit");
    expect(result.stderr).not.toContain("datatype mismatch");
  });

  it("BOUNDARY: --limit 0 exits 2 (floor is 1)", () => {
    const result = runLore(["log", docId, "--limit", "0"], tmpDir);
    expect(result.exitCode).toBe(2);
  });

  it("REGRESSION: --limit 1 (valid) still returns exactly 1 entry", () => {
    const result = runLore(["log", docId, "--limit", "1", "--json"], tmpDir);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as { data: { entries: unknown[] } };
    expect(parsed.data.entries).toHaveLength(1);
  });
});

// ─── tree --depth (BUG-008) ───────────────────────────────────────────────────

describe("lore tree --depth", () => {
  it("NEGATIVE: --depth abc exits 2 instead of silently defeating the recursion depth cap (BUG-008)", () => {
    const result = runLore(["tree", "--depth", "abc"], tmpDir);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--depth");
  });

  it("BOUNDARY: --depth 0 exits 2 (floor is 1)", () => {
    const result = runLore(["tree", "--depth", "0"], tmpDir);
    expect(result.exitCode).toBe(2);
  });

  it("REGRESSION: --depth 1 (valid) still renders a tree", () => {
    const result = runLore(["tree", "--depth", "1"], tmpDir);
    expect(result.exitCode).toBe(0);
  });
});

// ─── diff --from/--to (BUG-007) ───────────────────────────────────────────────

describe("lore diff --from/--to", () => {
  it("NEGATIVE: --from abc exits 2 instead of throwing a bare bun:sqlite error (BUG-007)", () => {
    const result = runLore(["diff", docId, "--from", "abc"], tmpDir);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--from");
    expect(result.stderr).not.toContain("datatype mismatch");
  });

  it("BOUNDARY: --to 0 exits 2 (version numbers start at 1)", () => {
    const result = runLore(["diff", docId, "--to", "0"], tmpDir);
    expect(result.exitCode).toBe(2);
  });

  it("REGRESSION: --from 1 --to 2 (valid) still diffs", () => {
    const result = runLore(["diff", docId, "--from", "1", "--to", "2", "--json"], tmpDir);
    expect(result.exitCode).toBe(0);
  });
});

// ─── audit --limit (BUG-007) ──────────────────────────────────────────────────

describe("lore audit --limit", () => {
  it("NEGATIVE: --limit abc exits 2 instead of throwing a bare bun:sqlite error (BUG-007)", () => {
    const result = runLore(["audit", "--limit", "abc"], tmpDir);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--limit");
    expect(result.stderr).not.toContain("datatype mismatch");
  });

  it("REGRESSION: --limit 5 (valid) still queries the audit trail", () => {
    const result = runLore(["audit", "--limit", "5", "--json"], tmpDir);
    expect(result.exitCode).toBe(0);
  });
});

// ─── review --staleness --limit/--min-age-days (BUG-012) ────────────────────

describe("lore review --staleness --limit/--min-age-days", () => {
  it("NEGATIVE: --limit -1 exits 2 before ever reaching selectProbeCandidates's .slice() (BUG-012)", () => {
    const result = runLore(["review", "--staleness", "--limit", "-1"], tmpDir);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--limit");
  });

  it("NEGATIVE: --min-age-days abc exits 2", () => {
    const result = runLore(["review", "--staleness", "--min-age-days", "abc"], tmpDir);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--min-age-days");
  });

  it("BOUNDARY: --limit 0 exits 2 (batch staleness floor is 1 — a probe run of size 0 is a no-op flag error, not a legal request)", () => {
    const result = runLore(["review", "--staleness", "--limit", "0"], tmpDir);
    expect(result.exitCode).toBe(2);
  });
});
