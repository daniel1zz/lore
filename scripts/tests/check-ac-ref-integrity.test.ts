/**
 * Tests for `scripts/check-ac-ref-integrity.ts` (spec-lore-ac-set-in-place-edit-of-a-
 * declared-acceptance D7, AC-ACS-7): the corpus-wide dangling-`ac_ref` detector, its
 * pure resolution/ledger algorithm, and the real (mkdtemp + `lore init`) fixture proof
 * that the detector's assertion is actually LIVE — a detector that only ever runs
 * green is indistinguishable from one that measures nothing (AC-ACS-7's own text).
 *
 * Two halves, deliberately split by IO shape:
 *
 *   1. Pure algorithm suites (`resolveGoverningSpec`/`extractDeclaredAcIds`/
 *      `findDanglingRefs`/ledger) import directly from
 *      `../check-ac-ref-integrity-core.js` — that module has NO `bun:sqlite`
 *      dependency anywhere in its import graph (see its own header for why: the
 *      sibling `check-ac-ref-integrity.ts` IO shell imports `createApp`
 *      (`packages/lore/src/app.ts`), which top-level-imports `bun:sqlite`; a
 *      throwaway smoke test THIS task ran confirmed that importing that chain from a
 *      vitest-executed `.test.ts` file fails at module-resolve time — even behind a
 *      lazy `await import(...)` — with `Error: Cannot find package 'bun:sqlite'`).
 *
 *   2. The end-to-end fixture suite drives the REAL detector script + REAL `lore` CLI
 *      as subprocesses (mirrors `packages/lore/tests/integration/cli/task-workflow.test.ts`'s
 *      established `runLore` pattern) against a `mkdtemp` + `lore init` throwaway
 *      corpus — NEVER the repo's own `.lore/` (project CLAUDE.md's hard prohibition;
 *      see `packages/dashboard/tests/e2e/global-setup.ts` for the canonical
 *      "never pollute the live corpus" discipline this mirrors). The RED (seeded
 *      dangling ref) case is asserted BEFORE the GREEN (no dangling ref) case,
 *      per this task's verification discipline: a detector that cannot fail must be
 *      caught before it is trusted.
 *
 * Six-dimension coverage for this file:
 *   HAPPY:      resolveGoverningSpec walks task -> plan -> spec correctly; a
 *               declared ac_ref is never reported dangling; a valid ledger file
 *               parses; the e2e GREEN fixture exits 0
 *   NEGATIVE:   an ac_ref absent from the governing spec's declared ids IS
 *               dangling; a task parented to a non-plan doc resolves no governing
 *               spec; a dangling ref with no matching ledger entry is newDangling;
 *               the e2e RED fixture exits non-zero and names the (task, ac_ref) pair
 *   BOUNDARY:   the SAME (task, ac_ref) pair from multiple evidence rows is
 *               deduped to exactly one DanglingRef; a spec with no
 *               extra.acceptance_criteria key at all yields an empty declared set;
 *               a dangling ref with specSlug===null can never be ledger-exempted
 *   ERROR:      malformed ledger JSON throws AcRefLedgerError("invalid_json");
 *               schema-invalid ledger content (missing "reason") throws
 *               AcRefLedgerError("schema"); a task with no resolvable governing
 *               spec (null parent_id) still reports its dangling ac_ref
 *   STATE:      an evidence row with NO ac_ref never contributes a finding
 *               alongside one that does, on the same task; a ledger entry whose
 *               (spec,id) no longer matches any real dangling ref is orphaned
 *   REGRESSION: the shipped scripts/ac-ref-exemption-ledger.json parses cleanly;
 *               findDanglingRefs output is deterministically sorted
 *
 * @spec_ref spec-lore-ac-set-in-place-edit-of-a-declared-acceptance §D7, AC-ACS-7
 * @spec_ref adr-a-newly-armed-structural-oracle-enforces-from-a-baseline (ledger shape)
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveGoverningSpec,
  extractDeclaredAcIds,
  findDanglingRefs,
  checkAcRefLedger,
  parseAcRefLedgerFile,
  loadLedgerFromDisk,
  AcRefLedgerError,
  LEDGER_RELATIVE_PATH,
  type AcRefLedgerEntry,
} from "../check-ac-ref-integrity-core.js";
import type { DocRecord, DocId } from "@lore/core";

// ─── Path setup ─────────────────────────────────────────────────────────────

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const LORE_ENTRY = join(REPO_ROOT, "packages", "lore", "src", "index.ts");
const DETECTOR_SCRIPT = join(REPO_ROOT, "scripts", "check-ac-ref-integrity.ts");
const ACTOR = "agent:ac-ref-fixture-test";

// ─── Pure fixtures (no IO) ──────────────────────────────────────────────────

let _seq = 0;
function nextId(): DocId {
  _seq += 1;
  return `01HFIX${String(_seq).padStart(20, "0")}`;
}

function makeDoc(overrides: Partial<DocRecord> & { type: DocRecord["type"] }): DocRecord {
  const id = nextId();
  return {
    id,
    slug: `${overrides.type}-fixture-${id.slice(-4)}`,
    role: "plan",
    title: `Fixture ${overrides.type}`,
    status: "draft",
    priority: "medium",
    content: "body",
    parent_id: null,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    created_by: "alice",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: {},
    ...overrides,
  } as DocRecord;
}

// ─── Pure: resolveGoverningSpec / extractDeclaredAcIds ─────────────────────

describe("resolveGoverningSpec", () => {
  it("HAPPY: walks task -> plan -> plan's parent spec", () => {
    const spec = makeDoc({ type: "spec", parent_id: null });
    const plan = makeDoc({ type: "plan", parent_id: spec.id });
    const task = makeDoc({ type: "task", parent_id: plan.id, extra: { plan_id: plan.id } });
    const docsById = new Map([[plan.id, plan], [spec.id, spec]]);

    expect(resolveGoverningSpec(task, docsById)).toBe(spec);
  });

  it("NEGATIVE: task's parent_id resolves to a non-plan doc -> null", () => {
    const notAPlan = makeDoc({ type: "spec" });
    const task = makeDoc({ type: "task", parent_id: notAPlan.id });
    const docsById = new Map([[notAPlan.id, notAPlan]]);

    expect(resolveGoverningSpec(task, docsById)).toBeNull();
  });

  it("NEGATIVE: plan's parent_id resolves to a non-spec doc -> null", () => {
    const prd = makeDoc({ type: "prd" });
    const plan = makeDoc({ type: "plan", parent_id: prd.id });
    const task = makeDoc({ type: "task", parent_id: plan.id });
    const docsById = new Map([[prd.id, prd], [plan.id, plan]]);

    expect(resolveGoverningSpec(task, docsById)).toBeNull();
  });

  it("BOUNDARY: task.parent_id === null -> null", () => {
    const task = makeDoc({ type: "task", parent_id: null });
    expect(resolveGoverningSpec(task, new Map())).toBeNull();
  });

  it("BOUNDARY: plan.parent_id === null -> null", () => {
    const plan = makeDoc({ type: "plan", parent_id: null });
    const task = makeDoc({ type: "task", parent_id: plan.id });
    const docsById = new Map([[plan.id, plan]]);

    expect(resolveGoverningSpec(task, docsById)).toBeNull();
  });

  it("ERROR: task.parent_id references an id absent from docsById -> null (never throws)", () => {
    const task = makeDoc({ type: "task", parent_id: "01HMISSINGPLANIDXXXXXX" });
    expect(() => resolveGoverningSpec(task, new Map())).not.toThrow();
    expect(resolveGoverningSpec(task, new Map())).toBeNull();
  });
});

describe("extractDeclaredAcIds", () => {
  it("HAPPY: returns every declared criterion id", () => {
    const spec = makeDoc({
      type: "spec",
      extra: {
        acceptance_criteria: [
          { id: "AC-1", statement: "first", verify: { mode: "script", oracle: "test", command: "bun test" } },
          { id: "AC-2", statement: "second", verify: { mode: "human", note: "n/a" } },
        ],
      },
    });
    expect(extractDeclaredAcIds(spec)).toEqual(new Set(["AC-1", "AC-2"]));
  });

  it("BOUNDARY: no extra.acceptance_criteria key at all -> empty set", () => {
    const spec = makeDoc({ type: "spec", extra: {} });
    expect(extractDeclaredAcIds(spec)).toEqual(new Set());
  });

  it("ERROR: malformed extra.acceptance_criteria (not an array) never throws -> empty set", () => {
    const spec = makeDoc({ type: "spec", extra: { acceptance_criteria: "not-an-array" } });
    expect(() => extractDeclaredAcIds(spec)).not.toThrow();
    expect(extractDeclaredAcIds(spec)).toEqual(new Set());
  });
});

// ─── Pure: findDanglingRefs ─────────────────────────────────────────────────

describe("findDanglingRefs", () => {
  function harness() {
    const spec = makeDoc({
      type: "spec",
      slug: "spec-under-test",
      extra: { acceptance_criteria: [{ id: "AC-OK", statement: "declared", verify: { mode: "script", oracle: "test", command: "bun test" } }] },
    });
    const plan = makeDoc({ type: "plan", parent_id: spec.id });
    const docsById = new Map([[plan.id, plan], [spec.id, spec]]);
    return { spec, plan, docsById };
  }

  it("HAPPY: an evidence row referencing a DECLARED ac_ref is never dangling", () => {
    const { plan, docsById } = harness();
    const task = makeDoc({
      type: "task",
      slug: "task-happy",
      parent_id: plan.id,
      extra: {
        plan_id: plan.id,
        verification_evidence: [
          { oracle: "test", command: "x", result: "pass", recorded_at: "2026-08-01T00:00:00.000Z", recorded_by: "a", ac_ref: "AC-OK" },
        ],
      },
    });
    expect(findDanglingRefs([task], docsById)).toEqual([]);
  });

  it("NEGATIVE: an evidence row referencing an UNDECLARED ac_ref is dangling, naming the governing spec", () => {
    const { spec, plan, docsById } = harness();
    const task = makeDoc({
      type: "task",
      slug: "task-negative",
      parent_id: plan.id,
      extra: {
        plan_id: plan.id,
        verification_evidence: [
          { oracle: "test", command: "x", result: "pass", recorded_at: "2026-08-01T00:00:00.000Z", recorded_by: "a", ac_ref: "AC-GONE" },
        ],
      },
    });
    expect(findDanglingRefs([task], docsById)).toEqual([
      { taskId: task.id, taskSlug: "task-negative", acRef: "AC-GONE", specSlug: "spec-under-test" },
    ]);
  });

  it("BOUNDARY: the SAME dangling (task, ac_ref) pair across multiple evidence rows is deduped to ONE entry", () => {
    const { plan, docsById } = harness();
    const task = makeDoc({
      type: "task",
      slug: "task-dedup",
      parent_id: plan.id,
      extra: {
        plan_id: plan.id,
        verification_evidence: [
          { oracle: "test", command: "x", result: "pass", recorded_at: "2026-08-01T00:00:00.000Z", recorded_by: "a", ac_ref: "AC-GONE" },
          { oracle: "e2e", command: "y", result: "fail", recorded_at: "2026-08-01T01:00:00.000Z", recorded_by: "a", ac_ref: "AC-GONE" },
        ],
      },
    });
    const result = findDanglingRefs([task], docsById);
    expect(result.length).toBe(1);
    expect(result[0]?.acRef).toBe("AC-GONE");
  });

  it("STATE: a row with no ac_ref never contributes a finding alongside a dangling one on the same task", () => {
    const { plan, docsById } = harness();
    const task = makeDoc({
      type: "task",
      slug: "task-mixed",
      parent_id: plan.id,
      extra: {
        plan_id: plan.id,
        verification_evidence: [
          { oracle: "tsc", command: "z", result: "pass", recorded_at: "2026-08-01T00:00:00.000Z", recorded_by: "a" },
          { oracle: "test", command: "x", result: "pass", recorded_at: "2026-08-01T00:00:00.000Z", recorded_by: "a", ac_ref: "AC-GONE" },
        ],
      },
    });
    const result = findDanglingRefs([task], docsById);
    expect(result.length).toBe(1);
    expect(result[0]?.acRef).toBe("AC-GONE");
  });

  it("ERROR: a task with NO resolvable governing spec (null parent_id) still reports its ac_ref, with specSlug null", () => {
    const task = makeDoc({
      type: "task",
      slug: "task-orphaned",
      parent_id: null,
      extra: {
        verification_evidence: [
          { oracle: "test", command: "x", result: "pass", recorded_at: "2026-08-01T00:00:00.000Z", recorded_by: "a", ac_ref: "AC-ANYTHING" },
        ],
      },
    });
    expect(findDanglingRefs([task], new Map())).toEqual([
      { taskId: task.id, taskSlug: "task-orphaned", acRef: "AC-ANYTHING", specSlug: null },
    ]);
  });

  it("REGRESSION: output is sorted deterministically by (taskSlug, acRef)", () => {
    const { plan, docsById } = harness();
    const taskB = makeDoc({
      type: "task",
      slug: "task-b",
      parent_id: plan.id,
      extra: { plan_id: plan.id, verification_evidence: [{ oracle: "test", command: "x", result: "pass", recorded_at: "2026-08-01T00:00:00.000Z", recorded_by: "a", ac_ref: "AC-GONE" }] },
    });
    const taskA = makeDoc({
      type: "task",
      slug: "task-a",
      parent_id: plan.id,
      extra: { plan_id: plan.id, verification_evidence: [{ oracle: "test", command: "x", result: "pass", recorded_at: "2026-08-01T00:00:00.000Z", recorded_by: "a", ac_ref: "AC-GONE" }] },
    });
    const result = findDanglingRefs([taskB, taskA], docsById);
    expect(result.map((r) => r.taskSlug)).toEqual(["task-a", "task-b"]);
  });
});

// ─── Pure: exemption ledger ─────────────────────────────────────────────────

describe("checkAcRefLedger", () => {
  const dangling = [
    { taskId: "01HT1", taskSlug: "task-1", acRef: "AC-RETIRED", specSlug: "spec-a" },
  ];

  it("HAPPY: a dangling ref matching a ledger entry (same spec + id) is exempted, not newDangling", () => {
    const entries: AcRefLedgerEntry[] = [{ id: "AC-RETIRED", spec: "spec-a", date: "2026-08-01", reason: "merged into AC-OTHER" }];
    const result = checkAcRefLedger(dangling, entries);
    expect(result.newDangling).toEqual([]);
    expect(result.exempted).toEqual(dangling);
    expect(result.orphanedEntries).toEqual([]);
  });

  it("NEGATIVE: a dangling ref with no matching ledger entry is newDangling", () => {
    const result = checkAcRefLedger(dangling, []);
    expect(result.newDangling).toEqual(dangling);
    expect(result.exempted).toEqual([]);
  });

  it("BOUNDARY: a dangling ref with specSlug null can never be ledger-exempted, even by a coincidental id match", () => {
    const orphanRef = [{ taskId: "01HT2", taskSlug: "task-2", acRef: "AC-RETIRED", specSlug: null }];
    const entries: AcRefLedgerEntry[] = [{ id: "AC-RETIRED", spec: "spec-a", date: "2026-08-01", reason: "n/a" }];
    const result = checkAcRefLedger(orphanRef, entries);
    expect(result.newDangling).toEqual(orphanRef);
  });

  it("STATE: a ledger entry whose (spec,id) matches no current dangling ref is orphaned", () => {
    const entries: AcRefLedgerEntry[] = [
      { id: "AC-RETIRED", spec: "spec-a", date: "2026-08-01", reason: "merged" },
      { id: "AC-STALE", spec: "spec-b", date: "2026-07-01", reason: "fixed since" },
    ];
    const result = checkAcRefLedger(dangling, entries);
    expect(result.orphanedEntries).toEqual([entries[1]]);
    expect(result.newDangling).toEqual([]);
  });

  it("REGRESSION: a spec-scoped id match is required — a same-id exemption for a DIFFERENT spec does not exempt", () => {
    const entries: AcRefLedgerEntry[] = [{ id: "AC-RETIRED", spec: "spec-different", date: "2026-08-01", reason: "n/a" }];
    const result = checkAcRefLedger(dangling, entries);
    expect(result.newDangling).toEqual(dangling);
    expect(result.orphanedEntries).toEqual(entries);
  });
});

describe("parseAcRefLedgerFile / loadLedgerFromDisk", () => {
  it("HAPPY: a well-formed ledger string parses", () => {
    const raw = JSON.stringify({ note: "n", entries: [{ id: "AC-1", spec: "spec-a", date: "2026-08-01", reason: "r" }] });
    expect(parseAcRefLedgerFile(raw)).toEqual({ note: "n", entries: [{ id: "AC-1", spec: "spec-a", date: "2026-08-01", reason: "r" }] });
  });

  it("ERROR: malformed JSON throws AcRefLedgerError('invalid_json')", () => {
    expect(() => parseAcRefLedgerFile("{not json")).toThrow(AcRefLedgerError);
    try {
      parseAcRefLedgerFile("{not json");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AcRefLedgerError);
      expect((e as AcRefLedgerError).code).toBe("invalid_json");
    }
  });

  it("ERROR: schema-invalid content (entry missing 'reason') throws AcRefLedgerError('schema')", () => {
    const raw = JSON.stringify({ entries: [{ id: "AC-1", spec: "spec-a", date: "2026-08-01" }] });
    try {
      parseAcRefLedgerFile(raw);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AcRefLedgerError);
      expect((e as AcRefLedgerError).code).toBe("schema");
    }
  });

  it("ERROR: a missing ledger file throws AcRefLedgerError('not_found')", () => {
    const bogusRoot = join(tmpdir(), "definitely-does-not-exist-ac-ref-ledger-test");
    try {
      loadLedgerFromDisk(bogusRoot);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AcRefLedgerError);
      expect((e as AcRefLedgerError).code).toBe("not_found");
    }
  });

  it("REGRESSION: the shipped scripts/ac-ref-exemption-ledger.json parses cleanly against the real repo root", () => {
    const ledger = loadLedgerFromDisk(REPO_ROOT);
    expect(Array.isArray(ledger.entries)).toBe(true);
  });

  it("REGRESSION: LEDGER_RELATIVE_PATH names the shipped file", () => {
    expect(LEDGER_RELATIVE_PATH).toBe("scripts/ac-ref-exemption-ledger.json");
  });
});

// ─── End-to-end fixture: mkdtemp + lore init, never the repo's own .lore/ ─────

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** Spawns `bun run <LORE_ENTRY> ...args` in `cwd` — explicit maxBuffer per this repo's spawnSync-truncation discipline (project CLAUDE.md), even though every payload here is small. */
function runLore(args: string[], cwd: string): RunResult {
  const result = spawnSync("bun", ["run", LORE_ENTRY, ...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    env: { ...process.env, CLAUDECODE: "1" },
  });
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", exitCode: result.status ?? 1 };
}

/**
 * Builds a throwaway "repo root" containing only an EMPTY `scripts/ac-ref-exemption-ledger.json`
 * (`{"entries": []}`) at the exact `LEDGER_RELATIVE_PATH` the real detector reads. Passed to
 * `runDetector` via `LORE_AC_REF_LEDGER_REPO_ROOT` so this fixture's corpus-scan assertions
 * stay independent of the REAL repo's shipped ledger content — which, once it carries any
 * entry (task-t3, 2026-08-01), would otherwise make every one of THIS fixture's unrelated,
 * throwaway-corpus runs report those real entries as spuriously "orphaned" (they match no
 * dangling ref in a fixture corpus that never produced them) and fail loud for a reason that
 * has nothing to do with what this suite is actually proving.
 */
function initFixtureLedgerRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "lore-ac-ref-ledger-root-"));
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(join(root, LEDGER_RELATIVE_PATH), JSON.stringify({ entries: [] }), "utf8");
  return root;
}

/** Spawns the REAL detector script (`bun run scripts/check-ac-ref-integrity.ts`) with `cwd` set to the fixture corpus directory, exactly as the registered AC-ACS-7 oracle command would run it from that directory — pointed at an isolated throwaway ledger (see `initFixtureLedgerRoot`) so this fixture's own corpus-scan assertions are never coupled to the real repo's shipped ledger content. */
function runDetector(cwd: string): RunResult {
  const ledgerRoot = initFixtureLedgerRoot();
  try {
    const result = spawnSync("bun", ["run", DETECTOR_SCRIPT], {
      cwd,
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
      env: { ...process.env, LORE_AC_REF_LEDGER_REPO_ROOT: ledgerRoot },
    });
    return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", exitCode: result.status ?? 1 };
  } finally {
    rmSync(ledgerRoot, { recursive: true, force: true });
  }
}

function initFixtureCorpus(): string {
  const dir = mkdtempSync(join(tmpdir(), "lore-ac-ref-fixture-"));
  const init = runLore(["init", "--json"], dir);
  if (init.exitCode !== 0) {
    throw new Error(`fixture setup: lore init failed (exit ${init.exitCode}): ${init.stderr}`);
  }
  return dir;
}

function createDoc(
  cwd: string,
  type: string,
  title: string,
  content: string,
  extraArgs: string[],
): { id: string; slug: string } {
  const result = runLore(["create", type, "--title", title, "--content", content, "--by", ACTOR, "--json", ...extraArgs], cwd);
  if (result.exitCode !== 0) {
    throw new Error(`fixture setup: create ${type} failed (exit ${result.exitCode}): ${result.stderr}\n${result.stdout}`);
  }
  const parsed = JSON.parse(result.stdout) as { data: { id: string; slug: string } };
  return { id: parsed.data.id, slug: parsed.data.slug };
}

const FIXTURE_SPEC_CONTENT =
  "## Overview/Goal\n\nFixture spec for check-ac-ref-integrity's negative-control test.\n\n" +
  "## Scope\n\nOne throwaway criterion, force-removed after one evidence row references it.\n\n" +
  "## Acceptance Criteria\n\n- AC-FIX-1 -- placeholder, retired via `lore ac rm --force` immediately after use.\n";

const FIXTURE_AC_ID = "AC-FIX-1";

/**
 * Builds a fixture corpus (already `lore init`'d at `cwd`) carrying one task whose
 * evidence references `FIXTURE_AC_ID` on a declared criterion — and, when
 * `opts.forceRemove` is true, immediately force-removes that criterion the SAME way
 * a real `lore ac rm --force` (or a historical rm+add re-declare cycle) would,
 * leaving the evidence row's `ac_ref` genuinely dangling (spec D6/D7's own
 * described mechanism — this fixture does not fabricate a shortcut around it).
 */
function buildFixture(cwd: string, opts: { forceRemove: boolean }): { taskSlug: string; specSlug: string } {
  const prd = createDoc(cwd, "prd", "Fixture root PRD", "Fixture prd body.", []);
  const spec = createDoc(cwd, "spec", "Fixture spec with a retired criterion", FIXTURE_SPEC_CONTENT, ["--parent", prd.id]);

  const addAc = runLore(
    ["ac", "add", spec.id, FIXTURE_AC_ID, "--statement", "check-ac-ref-integrity negative-control criterion", "--mode", "script", "--oracle", "test", "--command", "true", "--json"],
    cwd,
  );
  if (addAc.exitCode !== 0) {
    throw new Error(`fixture setup: ac add failed (exit ${addAc.exitCode}): ${addAc.stderr}`);
  }

  const plan = createDoc(cwd, "plan", "Fixture plan", "Fixture plan body.", ["--parent", spec.id]);
  // reason: spec-declaring-ac-scope-is-required-at-task-creation-so-the (landed on
  // main mid-task, merged into this branch) — task-create is a gated checkpoint:
  // when the parent plan's spec-tier ancestor declares >= 1 script-mode AC, creation
  // is REFUSED without a declared --ac-scope (D1). This fixture's spec declares
  // exactly FIXTURE_AC_ID, so the task must claim it explicitly — an empty
  // --ac-scope would also satisfy the gate (D2) but would misrepresent what this
  // fixture task actually claims (it genuinely references FIXTURE_AC_ID in its
  // evidence below), so the real id is declared, not a vacuous empty array.
  const task = createDoc(cwd, "task", "Fixture task", "Fixture task body.", [
    "--plan-id",
    plan.id,
    "--ac-scope",
    FIXTURE_AC_ID,
  ]);

  const evidence = runLore(
    ["evidence", task.id, "--oracle", "test", "--command", "true", "--result", "pass", "--ac", FIXTURE_AC_ID, "--by", ACTOR, "--json"],
    cwd,
  );
  if (evidence.exitCode !== 0) {
    throw new Error(`fixture setup: evidence add failed (exit ${evidence.exitCode}): ${evidence.stderr}`);
  }

  if (opts.forceRemove) {
    const rm = runLore(["ac", "rm", spec.id, FIXTURE_AC_ID, "--force", "--json"], cwd);
    if (rm.exitCode !== 0) {
      throw new Error(`fixture setup: ac rm --force failed (exit ${rm.exitCode}): ${rm.stderr}`);
    }
  }

  return { taskSlug: task.slug, specSlug: spec.slug };
}

describe("check-ac-ref-integrity: end-to-end fixture (mkdtemp + lore init, never the repo's own .lore/)", () => {
  // NON-NEGOTIABLE: RED asserted before GREEN — a detector that cannot fail must be
  // caught before it is trusted (this task's verification discipline).

  it("NEGATIVE (RED first): a seeded dangling ac_ref (declare -> evidence -> rm --force) makes the real detector exit non-zero and name the (task, ac_ref) pair", () => {
    const cwd = initFixtureCorpus();
    try {
      const { taskSlug } = buildFixture(cwd, { forceRemove: true });
      const result = runDetector(cwd);

      expect(result.exitCode).not.toBe(0);
      const combinedOutput = result.stdout + result.stderr;
      expect(combinedOutput).toContain(taskSlug);
      expect(combinedOutput).toContain(FIXTURE_AC_ID);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 30000);

  it("HAPPY (GREEN second): a corpus with no dangling ac_ref makes the real detector exit 0", () => {
    const cwd = initFixtureCorpus();
    try {
      buildFixture(cwd, { forceRemove: false });
      const result = runDetector(cwd);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("OK");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 30000);
});
