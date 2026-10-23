// @spawns packages/lore/src/index.ts
/**
 * @spec_ref spec-a-write-side-fact-with-no-read-side-address-counts-with-no
 *           §Scope M1, AC-RR-2
 *
 * `lore trace stats --enumerate <unregistered field>` — refused BY NAME, exit
 * code exactly 4, naming both registered fields. Mirrors the contract
 * `lore status --enumerate` (AC-FR-5) already enforces: "a new `*_count` field
 * with no registered enumerator is refused by name", never a silent empty result.
 *
 * ⛔ Exit code is asserted as EXACTLY 4 (VALIDATION_ERROR), never "non-zero":
 * a citty usage error (2), an unhandled throw (1), or a missing-corpus exit
 * would each satisfy "non-zero" while proving nothing about the refusal path.
 *
 * Spawns the real CLI in SOURCE mode against a THROWAWAY corpus (mkdtemp).
 * ⛔ NEVER touches the repo's own `.lore/` corpus (project CLAUDE.md hard rule).
 *
 * Six-dimension coverage:
 *   HAPPY:      the CONTROL — a REGISTERED field name exits 0 and prints its
 *               member list, so a build that refuses EVERY field (which would
 *               pass every negative assertion below) still fails this file.
 *   NEGATIVE:   a plausible near-miss name (`never_read_docs`, missing the
 *               `_count` suffix) is refused, not silently coerced.
 *   BOUNDARY:   `counts_by_kind` / `deny_by_checkpoint` — fields that DO exist
 *               in the report but are deliberately NOT registered (they already
 *               ship their member breakdown as the field's own value) — are
 *               refused by the same path, so "exists in the report" is never
 *               mistaken for "enumerable".
 *   ERROR:      an entirely unknown field exits exactly 4 and its stderr names
 *               the offending field plus BOTH registered fields.
 *   STATE:      the refusal is stateless — it never writes a trace row and
 *               never leaves the corpus changed (row count identical after).
 *   REGRESSION: the refusal prints NO member list on stdout (not `0 member(s)`,
 *               not a JSON success envelope) even with `--json` — a silent empty
 *               result is the exact failure mode this AC exists to forbid.
 */

import { afterEach, describe, expect, it } from "vitest";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// tests/integration/cli/ -> tests/integration/ -> tests/ -> packages/lore/ (3 up)
const PACKAGE_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");

/** The field registered after BR-1373 removed the never-read-docs report (its `get` rows no longer exist). */
const REGISTERED_FIELDS = ["zero_hit_search_count"] as const;

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

function runLore(args: string[], cwd: string): RunResult {
  const proc = Bun.spawnSync(["bun", "run", INDEX_TS, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd, EDITOR: "true", CLAUDECODE: "1" },
  });
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode ?? 1,
  };
}

function initCorpus(dir: string): void {
  const result = runLore(["init"], dir);
  if (result.exitCode !== 0) throw new Error(`lore init failed: ${result.stderr}`);
}

function createPrd(dir: string, title: string): void {
  const result = runLore(["create", "prd", "--title", title, "--content", "x", "--json"], dir);
  if (result.exitCode !== 0) throw new Error(`lore create prd failed: ${result.stderr}`);
}

function traceEventCount(dir: string): number {
  const db = new Database(join(dir, ".lore", "lore.db"), { readonly: true });
  try {
    const row = db.query("SELECT COUNT(*) as count FROM trace_events").get() as { count: number };
    return row.count;
  } finally {
    db.close();
  }
}

/** Asserts one field name is refused by name, with exit code EXACTLY 4. */
function expectRefusedByName(dir: string, field: string, extraArgs: string[] = []): RunResult {
  const result = runLore(["trace", "stats", "--enumerate", field, ...extraArgs], dir);
  expect(result.exitCode).toBe(4);
  expect(result.stderr).toContain(field);
  for (const known of REGISTERED_FIELDS) {
    expect(result.stderr).toContain(known);
  }
  // ⛔ Never a silent empty result: no member list, no success envelope.
  expect(result.stdout).not.toContain("member(s)");
  expect(result.stdout).not.toContain('"ok": true');
  return result;
}

let tmpDir: string;

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

describe("AC-RR-2: an unregistered --enumerate field is refused by name with exit exactly 4", () => {
  it("ERROR/REGRESSION: an unknown field exits exactly 4, names itself and both registered fields, prints no list", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "lore-trace-enum-unregistered-"));
    initCorpus(tmpDir);

    expectRefusedByName(tmpDir, "totally_made_up_count");
    // Same refusal with --json — the JSON surface must not answer with an empty success payload.
    expectRefusedByName(tmpDir, "totally_made_up_count", ["--json"]);
  }, 60_000);

  it("NEGATIVE: a near-miss name missing the _count suffix is refused, never coerced", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "lore-trace-enum-nearmiss-"));
    initCorpus(tmpDir);

    expectRefusedByName(tmpDir, "never_read_docs");
    // reason: BR-1373 — removed with the per-read rows it was computed from; it must be refused, not answered empty.
    expectRefusedByName(tmpDir, "never_read_docs_count");
    expectRefusedByName(tmpDir, "zero_hit_search");
  }, 60_000);

  it("BOUNDARY: report fields that are deliberately NOT registered are refused by the same path", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "lore-trace-enum-unregistered-report-field-"));
    initCorpus(tmpDir);

    // These two DO appear in `trace stats --json` but ship their own member
    // breakdown as the field's value, so the spec explicitly leaves them out.
    expectRefusedByName(tmpDir, "counts_by_kind");
    expectRefusedByName(tmpDir, "deny_by_checkpoint");
  }, 60_000);

  it("HAPPY: the CONTROL — every registered field exits 0 and prints its member list", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "lore-trace-enum-control-"));
    initCorpus(tmpDir);
    createPrd(tmpDir, "Control Widget");

    for (const field of REGISTERED_FIELDS) {
      const result = runLore(["trace", "stats", "--enumerate", field], tmpDir);
      expect({ field, exitCode: result.exitCode }).toEqual({ field, exitCode: 0 });
      expect(result.stdout).toContain(`${field}: `);
      expect(result.stdout).toContain("member(s)");
    }
  }, 60_000);

  it("STATE: a refusal writes nothing — the trace_events row count is unchanged", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "lore-trace-enum-unregistered-state-"));
    initCorpus(tmpDir);
    createPrd(tmpDir, "State Widget");

    const before = traceEventCount(tmpDir);
    expectRefusedByName(tmpDir, "not_a_registered_count");
    expect(traceEventCount(tmpDir)).toBe(before);
  }, 60_000);
});
