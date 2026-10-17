// @spawns packages/lore/src/index.ts
/** @spec_ref AC-079-5 */
/**
 * Integration tests for `lore audit anchor` + `lore audit --verify`'s
 * external-anchor cross-check (SPEC-079 G3). Drives the REAL CLI via
 * subprocess against an isolated temp SQLite DB — same `bun run
 * <src/index.ts>` (source, never the compiled binary) pattern as
 * `tests/integration/cli/audit.test.ts`, so this suite is immune to the
 * "stale compiled binary" false-oracle vector (root CLAUDE.md dogfood log) —
 * no `dist/lore`/`bun run build` dependency at all.
 *
 * `.bun.test.ts` (not `.test.ts`/vitest) because the REGRESSION/ERROR
 * dimensions below tamper the on-disk `.lore/lore.db` directly via
 * `bun:sqlite`'s `Database` — the same low-level access
 * `tests/unit/store/audit-chain.bun.test.ts` uses, needed to simulate a
 * rewritten/rewound chain (something no legitimate CLI command can produce).
 *
 * ⛔ Never touches the repo's own `.lore/` corpus — every test runs inside
 * its own `mkdtempSync` directory (`HOME` and `cwd` both pointed at it,
 * mirroring `tests/integration/cli/audit.test.ts`'s established isolation
 * pattern), per the project CLAUDE.md hard rule.
 *
 * Six-dimension coverage:
 *   HAPPY:      `lore audit anchor` writes `.lore/audit-anchor.json` with the
 *               real chain head; `lore audit --verify --json` consumes it and
 *               reports `anchor.status: "clean"`, `chain.clean: true`,
 *               overall `clean: true`, exit 0
 *   NEGATIVE:   `lore audit anchor` on a freshly-init'd (audit-table-empty)
 *               corpus fails loud — exit 4, no file written (never a
 *               degenerate empty anchor)
 *   BOUNDARY:   an anchor set mid-chain stays `anchor.status: "clean"` after
 *               MORE audit-producing writes extend the chain past it — the
 *               anchor pins a past point, not necessarily the live tip
 *   ERROR:      a hand-corrupted (malformed JSON) `.lore/audit-anchor.json`
 *               fails `--verify` loud (exit 4, stderr names the file) rather
 *               than silently degrading to "absent"
 *   STATE:      re-running `lore audit anchor` moves the pinned head forward
 *               (overwrites the file, not append-only) — verify against the
 *               NEW anchor is clean; the OLD head_id/head_hash pair is gone
 *               from the file
 *   REGRESSION: the exact AC-079-5 scenario — a rewritten (entry_hash column
 *               of the anchored row directly overwritten) OR rewound
 *               (anchored row physically deleted, simulating a covered-up
 *               history rewrite) chain is reported as `anchor_mismatch`
 *               (`"hash_mismatch"` / `"row_missing"` respectively), exit 4
 *
 * @spec_ref SPEC-079 G3
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Database } from "bun:sqlite";

// ─── Path setup ───────────────────────────────────────────────────────────────

const PACKAGE_ROOT = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");

// ─── RunResult type ───────────────────────────────────────────────────────────

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/**
 * Spawn `bun run <INDEX_TS> ...args` in `cwd` with an isolated HOME dir —
 * runs from SOURCE (never `dist/lore`), so no build-freshness dependency.
 */
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

interface AuditAnchorFileShape {
  head_id: number;
  head_hash: string;
  entry_count: number;
  anchored_at: string;
}

interface VerifyJsonPayload {
  ok: boolean;
  data?: {
    clean: boolean;
    misses: unknown[];
    since: string;
    chain: { clean: boolean; checked: number; break?: { id: number; reason: string } };
    anchor:
      | { status: "absent" }
      | { status: "clean"; head_id: number; head_hash: string }
      | { status: "anchor_mismatch"; head_id: number; head_hash: string; reason: string };
  };
}

function anchorFilePath(cwd: string): string {
  return join(cwd, ".lore", "audit-anchor.json");
}

function dbPath(cwd: string): string {
  return join(cwd, ".lore", "lore.db");
}

function readAnchorFile(cwd: string): AuditAnchorFileShape {
  return JSON.parse(readFileSync(anchorFilePath(cwd), "utf8")) as AuditAnchorFileShape;
}

function runVerifyJson(cwd: string): VerifyJsonPayload {
  const result = runLore(["audit", "--verify", "--since", "2000-01-01T00:00:00.000Z", "--json"], cwd);
  return JSON.parse(result.stdout) as VerifyJsonPayload;
}

/** Directly overwrites one audit row's `entry_hash` column via bun:sqlite — simulates an in-place rewrite. */
function forgeEntryHash(cwd: string, id: number, fakeHash: string): void {
  const db = new Database(dbPath(cwd));
  try {
    db.run("UPDATE audit SET entry_hash = ? WHERE id = ?", [fakeHash, id]);
  } finally {
    db.close();
  }
}

/** Directly deletes one audit row via bun:sqlite — simulates a covered-up history rewrite/rewind. */
function deleteAuditRow(cwd: string, id: number): void {
  const db = new Database(dbPath(cwd));
  try {
    db.run("DELETE FROM audit WHERE id = ?", [id]);
  } finally {
    db.close();
  }
}

function auditRowIds(cwd: string): number[] {
  const db = new Database(dbPath(cwd));
  try {
    const rows = db.query("SELECT id FROM audit ORDER BY id ASC").all() as { id: number }[];
    return rows.map((r) => r.id);
  } finally {
    db.close();
  }
}

// ─── Fixture helpers ──────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(
    tmpdir(),
    `lore-audit-anchor-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

// ─── HAPPY ────────────────────────────────────────────────────────────────────

describe("lore audit anchor — HAPPY", () => {
  it("writes .lore/audit-anchor.json with the real chain head, and --verify --json consumes it clean", () => {
    createPrd("Anchor HAPPY PRD One");
    createPrd("Anchor HAPPY PRD Two");

    const anchorResult = runLore(["audit", "anchor", "--json"], tmpDir);
    expect(anchorResult.exitCode).toBe(0);

    const parsed = JSON.parse(anchorResult.stdout) as { ok: boolean; data?: AuditAnchorFileShape };
    expect(parsed.ok).toBe(true);
    expect(parsed.data?.head_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(parsed.data?.entry_count).toBeGreaterThanOrEqual(2);

    const data = parsed.data;
    expect(data).toBeDefined();
    if (data === undefined) return;

    const onDisk = readAnchorFile(tmpDir);
    expect(onDisk.head_id).toBe(data.head_id);
    expect(onDisk.head_hash).toBe(data.head_hash);

    const verify = runVerifyJson(tmpDir);
    expect(verify.data?.clean).toBe(true);
    expect(verify.data?.chain.clean).toBe(true);
    expect(verify.data?.anchor).toEqual({ status: "clean", head_id: onDisk.head_id, head_hash: onDisk.head_hash });

    const verifyExit = runLore(["audit", "--verify", "--since", "2000-01-01T00:00:00.000Z"], tmpDir);
    expect(verifyExit.exitCode).toBe(0);
  });

  it("non-JSON --verify output prints a clean chain-integrity line and an anchor-verified line", () => {
    createPrd("Anchor HAPPY Human PRD");
    runLore(["audit", "anchor"], tmpDir);

    const result = runLore(["audit", "--verify", "--since", "2000-01-01T00:00:00.000Z"], tmpDir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toLowerCase()).toContain("chain integrity: clean");
    expect(result.stdout.toLowerCase()).toContain("anchor: verified");
  });
});

// ─── NEGATIVE ─────────────────────────────────────────────────────────────────

describe("lore audit anchor — NEGATIVE", () => {
  it("on a freshly-init'd corpus (empty audit table) fails loud — exit 4, no file written", () => {
    // reason: `lore init` now writes the one `state-binding-armed` audit row (AC-CT-3), so a fresh corpus
    // is no longer audit-empty. Empty the table directly to keep exercising the empty-table refusal.
    const db = new Database(dbPath(tmpDir));
    try {
      db.run("DELETE FROM audit");
    } finally {
      db.close();
    }
    const result = runLore(["audit", "anchor"], tmpDir);
    expect(result.exitCode).toBe(4);
    expect(result.stderr.length).toBeGreaterThan(0);

    // no anchor file should have been created
    const verify = runVerifyJson(tmpDir);
    expect(verify.data?.anchor).toEqual({ status: "absent" });
  });
});

// ─── BOUNDARY ─────────────────────────────────────────────────────────────────

describe("lore audit anchor — BOUNDARY", () => {
  it("an anchor pinned mid-chain stays clean after further writes extend the chain past it", () => {
    createPrd("Anchor Boundary PRD One");

    const anchorResult = runLore(["audit", "anchor", "--json"], tmpDir);
    const anchored = (JSON.parse(anchorResult.stdout) as { data: AuditAnchorFileShape }).data;

    // Extend the chain well past the anchored point.
    createPrd("Anchor Boundary PRD Two");
    createPrd("Anchor Boundary PRD Three");
    const slugFour = createPrd("Anchor Boundary PRD Four");
    runLore(["approve", slugFour], tmpDir);

    const verify = runVerifyJson(tmpDir);
    expect(verify.data?.clean).toBe(true);
    expect(verify.data?.anchor).toEqual({ status: "clean", head_id: anchored.head_id, head_hash: anchored.head_hash });
    // The chain walk itself checked strictly more rows than were present at anchor time.
    expect(verify.data?.chain.checked).toBeGreaterThan(anchored.entry_count);
  });
});

// ─── ERROR ────────────────────────────────────────────────────────────────────

describe("lore audit anchor — ERROR", () => {
  it("a hand-corrupted (malformed JSON) anchor file fails --verify loud instead of degrading to absent", () => {
    createPrd("Anchor Error PRD");
    runLore(["audit", "anchor"], tmpDir);

    // Corrupt the file with invalid JSON.
    writeFileSync(anchorFilePath(tmpDir), "{ not valid json", "utf8");

    const result = runLore(["audit", "--verify", "--since", "2000-01-01T00:00:00.000Z"], tmpDir);
    expect(result.exitCode).toBe(4);
    expect(result.stderr.toLowerCase()).toContain("malformed");
    expect(result.stderr).toContain("audit-anchor.json");
  });
});

// ─── STATE ────────────────────────────────────────────────────────────────────

describe("lore audit anchor — STATE", () => {
  it("re-running `lore audit anchor` overwrites the file with the NEW head (never append-only)", () => {
    createPrd("Anchor State PRD One");
    const firstAnchorResult = runLore(["audit", "anchor", "--json"], tmpDir);
    const firstAnchor = (JSON.parse(firstAnchorResult.stdout) as { data: AuditAnchorFileShape }).data;

    createPrd("Anchor State PRD Two");
    const secondAnchorResult = runLore(["audit", "anchor", "--json"], tmpDir);
    const secondAnchor = (JSON.parse(secondAnchorResult.stdout) as { data: AuditAnchorFileShape }).data;

    expect(secondAnchor.head_id).toBeGreaterThan(firstAnchor.head_id);
    expect(secondAnchor.head_hash).not.toBe(firstAnchor.head_hash);

    const onDisk = readAnchorFile(tmpDir);
    expect(onDisk.head_id).toBe(secondAnchor.head_id);
    expect(onDisk.head_hash).toBe(secondAnchor.head_hash);

    const verify = runVerifyJson(tmpDir);
    expect(verify.data?.anchor).toEqual({ status: "clean", head_id: secondAnchor.head_id, head_hash: secondAnchor.head_hash });
  });
});

// ─── REGRESSION — the AC-079-5 core scenario ─────────────────────────────────

describe("lore audit anchor — REGRESSION (rewritten/rewound chain → anchor_mismatch)", () => {
  it("directly overwriting the anchored row's entry_hash column (rewrite) reports anchor_mismatch: hash_mismatch", () => {
    createPrd("Anchor Regression Rewrite PRD");
    const anchorResult = runLore(["audit", "anchor", "--json"], tmpDir);
    const anchored = (JSON.parse(anchorResult.stdout) as { data: AuditAnchorFileShape }).data;

    forgeEntryHash(tmpDir, anchored.head_id, "f".repeat(64));

    const verify = runVerifyJson(tmpDir);
    expect(verify.data?.clean).toBe(false);
    expect(verify.data?.anchor).toMatchObject({
      status: "anchor_mismatch",
      head_id: anchored.head_id,
      head_hash: anchored.head_hash,
      reason: "hash_mismatch",
    });

    const verifyExit = runLore(["audit", "--verify", "--since", "2000-01-01T00:00:00.000Z"], tmpDir);
    expect(verifyExit.exitCode).toBe(4);
    expect(verifyExit.stdout.toLowerCase()).toContain("mismatch");
  });

  it("physically deleting the anchored row (rewind/cover-up) reports anchor_mismatch: row_missing", () => {
    createPrd("Anchor Regression Rewind PRD One");
    const anchorResult = runLore(["audit", "anchor", "--json"], tmpDir);
    const anchored = (JSON.parse(anchorResult.stdout) as { data: AuditAnchorFileShape }).data;

    // Extend the chain past the anchor so deleting the anchored row alone
    // (not the live tip) is what's under test — a genuine "rewind" that
    // erased a specific past row, chain otherwise intact around it.
    createPrd("Anchor Regression Rewind PRD Two");

    const ids = auditRowIds(tmpDir);
    expect(ids).toContain(anchored.head_id);
    deleteAuditRow(tmpDir, anchored.head_id);

    const verify = runVerifyJson(tmpDir);
    expect(verify.data?.clean).toBe(false);
    expect(verify.data?.anchor).toMatchObject({
      status: "anchor_mismatch",
      head_id: anchored.head_id,
      head_hash: anchored.head_hash,
      reason: "row_missing",
    });
    // Deleting a row also breaks the chain walk itself (the surviving
    // successor's prev_hash now points at a hash that's no longer the
    // walker's current head) — both signals fire, neither masks the other.
    expect(verify.data?.chain.clean).toBe(false);

    const verifyExit = runLore(["audit", "--verify", "--since", "2000-01-01T00:00:00.000Z"], tmpDir);
    expect(verifyExit.exitCode).toBe(4);
  });
});
