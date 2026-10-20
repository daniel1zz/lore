// @spawns packages/lore/src/index.ts
/**
 * Integration tests for `lore audit` CLI subcommand (SPEC-035 §2). Runs the real
 * CLI via subprocess against an isolated temp SQLite DB — same pattern as
 * tests/integration/cli/task-workflow.test.ts.
 *
 * Scope: translation-only (args → AuditService call → exit code / output shape)
 * plus the corpus-wide `--verify` regression oracle. Business rules for `verify`'s
 * versions⋈audit reconcile (misses, watermark filtering, join-key exactness) are
 * exhaustively covered at the service layer
 * (tests/unit/service/audit-service.test.ts) — there is no CLI path to bypass the
 * write-then-audit pairing, so a genuine `--verify` MISS is not reproduced here.
 *
 * Coverage:
 *   HAPPY:      `lore audit <slug>` (human + --json) shows the create entry
 *   NEGATIVE:   `lore audit <nonexistent-slug>` → exit 3 (DOC_NOT_FOUND)
 *   BOUNDARY:   `--actor`/`--action` filters narrow the --json result set
 *   REGRESSION: `lore audit --verify` reports clean on a freshly-created +
 *               approved corpus — every writer (create/update/approve) stays
 *               audit-complete
 *
 * @spec_ref SPEC-035 §2
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "child_process";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { sessionActorFor, withSessionIdentity } from "../../helpers/session-actor.js";

// ─── Path setup ───────────────────────────────────────────────────────────────

const PACKAGE_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");

// ─── RunResult type ───────────────────────────────────────────────────────────

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/**
 * Spawn `bun run <INDEX_TS> ...args` in `cwd` with an isolated HOME dir.
 * MOCK RISK: none — this calls the real CLI binary path.
 */
function runLore(args: string[], cwd: string): RunResult {
  const result = spawnSync("bun", ["run", INDEX_TS, ...args], {
    cwd,
    env: withSessionIdentity({ ...process.env, HOME: cwd, EDITOR: "true", CLAUDECODE: "1" }, "test-actor") as Record<string, string>,
    encoding: "utf8",
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status ?? 1,
  };
}

// ─── Fixture helpers ──────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(
    tmpdir(),
    `lore-audit-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(tmpDir, { recursive: true });

  const init = runLore(["init"], tmpDir);
  if (init.exitCode !== 0) {
    throw new Error(`lore init failed: ${init.stderr}`);
  }
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore cleanup errors */
  }
});

// SPEC-079 G2 (actor fidelity) — every spawn runs under the `test-actor` SESSION identity, which makes the
// resulting create audit entry's actor DETERMINISTIC regardless of this test process's own ambient env
// (a real dev/CI shell may have $CLAUDE_CODE_SESSION_ID set; `withSessionIdentity` replaces it). Before
// SPEC-079, every create's audit entry hardcoded the literal "system"; now it carries the resolved actor.
const TEST_ACTOR = sessionActorFor("test-actor");

function createPrd(title: string): string {
  const r = runLore(
    ["create", "prd", "--title", title, "--no-ai", "--content", "body"],
    tmpDir,
  );
  if (r.exitCode !== 0) throw new Error(`create prd failed: ${r.stderr}`);
  const m = r.stdout.match(/Slug:\s+(\S+)/);
  const slug = m?.[1];
  if (!slug) throw new Error(`Could not extract prd slug from: ${r.stdout}`);
  return slug;
}

// ─── HAPPY — lore audit <doc> ─────────────────────────────────────────────────

describe("lore audit <doc> — HAPPY", () => {
  it(`non-JSON output exits 0 and shows the create entry (actor ${TEST_ACTOR}, action create)`, () => {
    const slug = createPrd("Audit CLI PRD");

    const result = runLore(["audit", slug], tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(TEST_ACTOR);
    expect(result.stdout.toLowerCase()).toContain("create");
  });

  it("--json exits 0 with data.entries containing action:'create' and details.version === 1", () => {
    const slug = createPrd("Audit CLI JSON PRD");

    const result = runLore(["audit", slug, "--json"], tmpDir);

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      ok: boolean;
      data?: { entries?: Array<{ action: string; actor: string; details?: Record<string, unknown> }> };
    };
    expect(parsed.ok).toBe(true);
    expect(Array.isArray(parsed.data?.entries)).toBe(true);
    expect(parsed.data?.entries?.length).toBeGreaterThan(0);
    const createEntry = parsed.data?.entries?.find((e) => e.action === "create");
    expect(createEntry).toBeDefined();
    expect(createEntry?.actor).toBe(TEST_ACTOR);
    expect(createEntry?.details?.["version"]).toBe(1);
  });
});

// ─── NEGATIVE — lore audit <nonexistent-slug> ────────────────────────────────

describe("lore audit <doc> — NEGATIVE", () => {
  it("a nonexistent doc slug exits 3 (DOC_NOT_FOUND)", () => {
    const result = runLore(["audit", "prd-does-not-exist"], tmpDir);
    expect(result.exitCode).toBe(3);
  });
});

// ─── BOUNDARY — filters narrow the result set ────────────────────────────────

describe("lore audit --actor/--action filters", () => {
  it(`--actor ${TEST_ACTOR} --action create --json returns only matching entries`, () => {
    const slugOne = createPrd("Filter PRD One");
    const slugTwo = createPrd("Filter PRD Two");
    void slugTwo;

    // Approve one doc so an "approve" (actor "system" — ReviewService is untouched
    // by SPEC-079 T1, out of scope) entry also exists, alongside the two creates.
    runLore(["approve", slugOne], tmpDir);

    const result = runLore(["audit", "--actor", TEST_ACTOR, "--action", "create", "--json"], tmpDir);

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      ok: boolean;
      data?: { entries?: Array<{ action: string; actor: string }> };
    };
    expect(parsed.ok).toBe(true);
    const entries = parsed.data?.entries ?? [];
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry.action).toBe("create");
      expect(entry.actor).toBe(TEST_ACTOR);
    }
  });

  it("an --action filter matching nothing returns an empty entries array (not a hardcoded non-empty stub)", () => {
    createPrd("Filter PRD No Match");

    const result = runLore(["audit", "--action", "restore", "--json"], tmpDir);

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as { ok: boolean; data?: { entries?: unknown[] } };
    expect(parsed.ok).toBe(true);
    expect(parsed.data?.entries).toEqual([]);
  });
});

// ─── REGRESSION — lore audit --verify stays clean across writers ────────────

describe("lore audit --verify — REGRESSION", () => {
  it("a freshly-created and approved corpus reports clean:true with no misses (--json)", () => {
    const slug = createPrd("Verify Clean PRD");
    const approveResult = runLore(["approve", slug], tmpDir);
    expect(approveResult.exitCode).toBe(0);

    const result = runLore(["audit", "--verify", "--json"], tmpDir);

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      ok: boolean;
      data?: { clean: boolean; misses: unknown[]; audited: number; reconstructed: number };
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.data?.clean).toBe(true);
    expect(parsed.data?.misses).toEqual([]);
  });

  it("the non-JSON message reports the corpus as complete", () => {
    createPrd("Verify Clean Human PRD");

    const result = runLore(["audit", "--verify"], tmpDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toLowerCase()).toContain("complete");
  });
});
