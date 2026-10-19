// @spawns packages/lore/src/index.ts
/**
 * @spec_ref spec-a-write-side-fact-with-no-read-side-address-counts-with-no
 *           §Scope M1, AC-RR-1
 *
 * `lore trace stats --enumerate never_read_docs_count` — the member list behind
 * the never-read count (M1: "every count `lore trace stats` reports is DERIVED
 * from a member list that the same command can print").
 *
 * Measured defect this file exists to keep closed: an all-time run on a consumer
 * corpus reported `Never-read docs: 168` against 276 live docs and offered NO way
 * to obtain the 168 ids — archiving, rewriting, and "this one was SUPPOSED to be
 * read" are all undecidable from the number alone.
 *
 * Spawns the real CLI in SOURCE mode (`bun run src/index.ts`, the precedent set
 * by the sibling `trace-stats.bun.test.ts`) against a THROWAWAY corpus created
 * with `mkdtemp(os.tmpdir())`. ⛔ NEVER touches the repo's own `.lore/` corpus
 * (project CLAUDE.md hard rule).
 *
 * Six-dimension coverage:
 *   HAPPY:      3 docs / 1 read → the enumeration returns EXACTLY the other two
 *               ids (set equality, so both an empty list and an off-by-one list
 *               fail), each carrying its slug, and the count reported by the
 *               plain `trace stats` run equals that list's LENGTH.
 *   NEGATIVE:   the count can never disagree with the list — asserted by reading
 *               both surfaces in the same corpus state and comparing.
 *   BOUNDARY:   every doc read → an EMPTY member list with count 0 (an empty
 *               list is a legitimate answer and must still render); and
 *               `--since` in the FUTURE → all 3 docs never-read in that window.
 *   ERROR:      n/a here — an unregistered field name is AC-RR-2's own file
 *               (`trace-enumerate-unregistered.bun.test.ts`).
 *   STATE:      reading a second doc SHRINKS the member list to exactly the one
 *               remaining doc — the list tracks corpus state, never a snapshot.
 *   REGRESSION: enumerating emits ZERO trace rows of its own (SPEC-102
 *               AC-TRACE-6 — a read surface that traced itself would make every
 *               subsequent never-read answer wrong).
 */

import { afterEach, describe, expect, it } from "vitest";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// tests/integration/cli/ -> tests/integration/ -> tests/ -> packages/lore/ (3 up)
const PACKAGE_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** Spawns the real CLI (source mode) with `cwd` as its working directory and `$HOME`. */
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

interface JsonEnvelope<T> {
  ok: boolean;
  data: T;
}

interface DocEnvelope {
  id: string;
  slug: string;
}

/** `--enumerate never_read_docs_count --json` payload (mirrors `lore status --enumerate`'s envelope). */
interface NeverReadEnumeration {
  field: string;
  count: number;
  members: { id: string; slug: string }[];
}

interface TraceStatsReport {
  since: string;
  zero_hit_search_count: number;
  never_read_docs_count: number;
}

function initCorpus(dir: string): void {
  const result = runLore(["init"], dir);
  if (result.exitCode !== 0) throw new Error(`lore init failed: ${result.stderr}`);
  // reason: `lore init` seeds one approved knowledge doc (the write-spec rule, DC2-5) that no one has read; the
  // never-read set asserted here is this suite's own documents, so the seed is soft-deleted.
  const dropped = runLore(["delete", "knowledge-write-spec-rules-gate-feeding-source", "--confirm"], dir);
  if (dropped.exitCode !== 0) throw new Error(`could not drop the init seed: ${dropped.stderr}`);
}

function createPrd(dir: string, title: string): DocEnvelope {
  const result = runLore(["create", "prd", "--title", title, "--content", "x", "--json"], dir);
  if (result.exitCode !== 0) throw new Error(`lore create prd failed: ${result.stderr}`);
  return (JSON.parse(result.stdout) as JsonEnvelope<DocEnvelope>).data;
}

function enumerateNeverRead(dir: string, extraArgs: string[] = []): NeverReadEnumeration {
  const result = runLore(
    ["trace", "stats", "--enumerate", "never_read_docs_count", "--json", ...extraArgs],
    dir,
  );
  expect({ exitCode: result.exitCode, stderr: result.stderr }).toEqual({ exitCode: 0, stderr: "" });
  return (JSON.parse(result.stdout) as JsonEnvelope<NeverReadEnumeration>).data;
}

function statsReport(dir: string, extraArgs: string[] = []): TraceStatsReport {
  const result = runLore(["trace", "stats", "--json", ...extraArgs], dir);
  expect(result.exitCode).toBe(0);
  return (JSON.parse(result.stdout) as JsonEnvelope<TraceStatsReport>).data;
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

let tmpDir: string;

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

describe("AC-RR-1: lore trace stats --enumerate never_read_docs_count", () => {
  it("HAPPY/NEGATIVE: returns EXACTLY the never-read ids, with slugs, and the reported count is that list's length", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "lore-trace-enum-neverread-"));
    initCorpus(tmpDir);

    const readDoc = createPrd(tmpDir, "Read Alpha Widget");
    const unreadOne = createPrd(tmpDir, "Unread Bravo Gadget");
    const unreadTwo = createPrd(tmpDir, "Unread Charlie Doohickey");

    expect(runLore(["get", readDoc.id], tmpDir).exitCode).toBe(0);

    const enumeration = enumerateNeverRead(tmpDir);

    expect(enumeration.field).toBe("never_read_docs_count");
    // Set equality — an empty list, a list of all three, and any off-by-one all fail here.
    expect(enumeration.members.map((m) => m.id).sort()).toEqual([unreadOne.id, unreadTwo.id].sort());
    // Actionable identity: the human-readable slug ships in the SAME payload.
    expect(enumeration.members.map((m) => m.slug).sort()).toEqual(
      [unreadOne.slug, unreadTwo.slug].sort(),
    );
    expect(enumeration.count).toBe(enumeration.members.length);
    expect(enumeration.count).toBe(2);

    // The count the plain run reports is DERIVED from that same list.
    const report = statsReport(tmpDir);
    expect(report.never_read_docs_count).toBe(enumeration.members.length);
  }, 60_000);

  it("HAPPY: the human (non --json) render prints the count alongside every member", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "lore-trace-enum-neverread-human-"));
    initCorpus(tmpDir);

    const readDoc = createPrd(tmpDir, "Human Read Alpha");
    const unread = createPrd(tmpDir, "Human Unread Bravo");
    expect(runLore(["get", readDoc.id], tmpDir).exitCode).toBe(0);

    const human = runLore(["trace", "stats", "--enumerate", "never_read_docs_count"], tmpDir);
    expect(human.exitCode).toBe(0);
    expect(human.stdout).toContain("never_read_docs_count: 1 member(s)");
    expect(human.stdout).toContain(unread.slug);
    expect(human.stdout).not.toContain(readDoc.slug);
  }, 60_000);

  it("STATE: reading a second doc shrinks the member list to exactly the one remaining doc", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "lore-trace-enum-neverread-state-"));
    initCorpus(tmpDir);

    const first = createPrd(tmpDir, "State Alpha");
    const second = createPrd(tmpDir, "State Bravo");
    const third = createPrd(tmpDir, "State Charlie");

    expect(runLore(["get", first.id], tmpDir).exitCode).toBe(0);
    expect(enumerateNeverRead(tmpDir).members.map((m) => m.id).sort()).toEqual(
      [second.id, third.id].sort(),
    );

    expect(runLore(["get", second.id], tmpDir).exitCode).toBe(0);
    const after = enumerateNeverRead(tmpDir);
    expect(after.members.map((m) => m.id)).toEqual([third.id]);
    expect(after.count).toBe(1);
  }, 60_000);

  it("BOUNDARY: every doc read → an empty member list with count 0; a future --since → all docs never-read", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "lore-trace-enum-neverread-boundary-"));
    initCorpus(tmpDir);

    const a = createPrd(tmpDir, "Boundary Alpha");
    const b = createPrd(tmpDir, "Boundary Bravo");
    const c = createPrd(tmpDir, "Boundary Charlie");
    for (const doc of [a, b, c]) {
      expect(runLore(["get", doc.id], tmpDir).exitCode).toBe(0);
    }

    const empty = enumerateNeverRead(tmpDir);
    expect(empty.members).toEqual([]);
    expect(empty.count).toBe(0);
    expect(statsReport(tmpDir).never_read_docs_count).toBe(0);

    // --since composes: a window that starts AFTER every `get` row has no reads in it,
    // so all three docs are never-read within that window.
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const windowed = enumerateNeverRead(tmpDir, ["--since", future]);
    expect(windowed.members.map((m) => m.id).sort()).toEqual([a.id, b.id, c.id].sort());
    expect(windowed.count).toBe(3);
    expect(statsReport(tmpDir, ["--since", future]).never_read_docs_count).toBe(3);
  }, 60_000);

  it("REGRESSION: enumerating emits ZERO trace rows of its own (SPEC-102 spec-trace-layer-read-deny-observability-table-default-on-with#AC-TRACE-6)", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "lore-trace-enum-neverread-norecursion-"));
    initCorpus(tmpDir);

    const doc = createPrd(tmpDir, "Norecursion Alpha");
    createPrd(tmpDir, "Norecursion Bravo");
    expect(runLore(["get", doc.id], tmpDir).exitCode).toBe(0);

    const before = traceEventCount(tmpDir);
    expect(before).toBeGreaterThan(0);

    expect(enumerateNeverRead(tmpDir).count).toBe(1);
    expect(traceEventCount(tmpDir)).toBe(before);

    expect(enumerateNeverRead(tmpDir).count).toBe(1);
    expect(traceEventCount(tmpDir)).toBe(before);
  }, 60_000);
});
