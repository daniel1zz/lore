// @spawns packages/lore/tests/fixtures/cite-retire-race-worker.ts
/**
 * @spec_ref AC-BLS2-3
 * @task task-skill-test-red-retire-vs-cite-race-ac-bls2-3 (RED; paired impl = C4 gate + migration-014)
 *
 * QA-2 / D6 of spec-baseline-slice-2-completeness-census-per-branch-citation: a rule is
 * retired while 8 other sessions cite it. Exactly one of each (retire, cite) pair wins; the
 * losing cite is refused (write absent) or its criterion is flagged. 0 criteria may cite a
 * retired rule without being refused-or-flagged. The liveness read happens INSIDE the citing
 * write's transaction (D6: registry `lifecycle`), so there is no check-then-write window.
 * Runner: `bun test` (bun:sqlite) - never vitest.
 *
 * REAL CONCURRENCY: 9 child processes (8 citers + 1 retirer), each with its OWN SQLiteStore
 * connection on one shared file, released together off a barrier file (same technique as
 * verbatim-slug-concurrency.bun.test.ts). bun:sqlite is synchronous, so Promise.all on one
 * connection would never contend.
 *
 * ── PINNED CONTRACT (the implementation builds to exactly this) ─────────────────────────
 *   - `new AcService(store, new RecordLockService(store, new GateEnforcer(undefined)), { citeGate: { mode: "off"|"report"|"enforce", armed_branches: string[] } })`
 *     `armed_branches` holds baseline BRANCH SLUGS. A spec is in the branch of the leaf its ACs
 *     cite (C4). `citeCriterion` consults the gate for the ids it ADDS.
 *   - enforce + armed branch + cited rule not live => `citeCriterion` returns `ok:false` with a
 *     gate-specific error code (anything except STORE_ERROR / STALE_VERSION / WRITE_CONTENTION /
 *     CONFLICT, which are infrastructure outcomes and never count as a legitimate refusal), and
 *     the spec doc is left untouched. report mode never refuses (records a would-refuse audit row).
 *   - Liveness is read from `rule_registry.lifecycle` (migration-014) in the citing write's
 *     transaction; `RuleService.setRule(.., {lifecycle:"retired"})` updates it in the retire tx.
 *   - `ac_cites(doc_id, ac_id, rule_id)` has a row for every criterion that cites a rule (C5).
 *   - "flagged" = counted in `computeBaselineStatus(...).cites_to_inactive`.
 *
 * ── RED STATE ───────────────────────────────────────────────────────────────────────────
 * Today citing is report-only and the registry has no lifecycle/ac_cites: cites land on a rule
 * that is already retired with no gate decision. The control (8 citers, no retirer) passes today.
 *
 * ── FALSIFIER (for the implementer / verifier) ──────────────────────────────────────────
 * Moving the liveness read OUT of the citing write's transaction (read lifecycle, then write
 * the spec in a separate tx) must turn the enforce race rounds red: some round lets a cite
 * land after the retire committed while the gate was armed.
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CreateDocInput, DocRecord } from "@lore/core";
import { AcService } from "../../../src/service/ac-service.js";
import { computeBaselineStatus } from "../../../src/service/baseline-status.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { RuleService } from "../../../src/service/rule-service.js";
import type { RuleStateService } from "../../../src/service/rule-state-service.js";
import { RuleStateService as RuleStateServiceImpl } from "../../../src/service/rule-state-service.js";
import { SQLiteStore } from "../../../src/store/sqlite-store.js";
import { makeRuleService } from "../../helpers/make-rule-service.js";
import { approveAllPending } from "../../helpers/approve-baseline.js";
import { actedStore } from "../../live-invocation.js";

const WORKER = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "fixtures", "cite-retire-race-worker.ts");
const WRITERS = 8;
const ROUNDS = 3;
const RULE_ID = "BR-1";
const AC_ID = "AC-R-1";
const BRANCH_SLUG = "baseline-race-branch";
const INFRA_CODES = new Set(["STORE_ERROR", "STALE_VERSION", "WRITE_CONTENTION", "CONFLICT", "THROWN"]);

type Mode = "off" | "report" | "enforce";
type WorkerResult = { ok: true } | { ok: false; code: string; message: string };

interface Fixture {
  dbPath: string;
  specIds: string[];
  leafId: string;
}

// ─── Fixture ────────────────────────────────────────────────────────────────

async function must<T>(r: { ok: boolean; value?: T; error?: unknown }, what: string): Promise<T> {
  if (!r.ok) throw new Error(`fixture ${what} failed: ${JSON.stringify(r.error)}`);
  return r.value as T;
}

/** Armed branch + one leaf holding live BR-1 + 8 specs each with one uncited criterion. */
async function seed(dir: string): Promise<Fixture> {
  const dbPath = join(dir, "corpus.db");
  const store = actedStore(new SQLiteStore(dbPath));
  const cs = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const rules = makeRuleService(store);
  const ac = new AcService(store, new RecordLockService(store, new GateEnforcer(undefined)));

  const prd = await must(await cs.create({ type: "prd", title: "Race product", content: "root" } as CreateDocInput), "prd");
  const root = await must(await rules.addNode(prd.id, { node: "root", label: "Root", title: "Race root", content: "r" }, { by: "agent:seed" }), "root");
  const branch = await must(
    await cs.create({
      type: "baseline", title: "Race branch", slug: BRANCH_SLUG, content: "b", parent_id: root.id,
      extra: { node: "branch", label: "Race branch", glossary: [{ term: "Race", meaning: "Concurrent writes" }] },
    } as CreateDocInput),
    "branch",
  );
  const leaf = await must(await rules.addNode(branch.id, { node: "leaf", label: "Race leaf", title: "Race leaf", content: "l" }, { by: "agent:seed" }), "leaf");
  const added = await must(
    await rules.addRule(leaf.id, {
      statement: "A retired rule is never cited without a flag",
      confidence: "established",
      enforced_by: "guaranteed",
      examples: ["cite after retire is refused or flagged"],
    }, { by: "agent:seed" }),
    "rule",
  );
  if (added.ruleId !== RULE_ID) throw new Error(`fixture expected first rule id ${RULE_ID}, got ${added.ruleId}`);
  await approveAllPending(store); // a direct add is a pending add: citable (live) only once approved
  await approveAllPending(store); // a direct add is a pending add: citable (live) only once approved

  const specIds: string[] = [];
  for (let i = 0; i < WRITERS; i += 1) {
    const spec = await must(
      await cs.create({ type: "spec", title: `Race spec ${i}`, content: `spec ${i}`} as CreateDocInput),
      `spec ${i}`,
    );
    await must(
      await ac.addCriterion(spec.id, {
        id: AC_ID,
        statement: `Criterion ${i} does one observable thing`,
        verify: { mode: "script", oracle: "test", command: "bun test x" },
      }),
      `criterion ${i}`,
    );
    specIds.push(spec.id);
  }
  store.close();
  return { dbPath, specIds, leafId: leaf.id };
}

// ─── Race runner (real processes) ───────────────────────────────────────────

async function waitForFile(path: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(path)) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${path}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

interface Raced {
  cites: WorkerResult[];
  retire: WorkerResult | null;
}

/** Spawn one worker per spec (+ a retirer when asked); release them together. */
async function race(dir: string, fx: Fixture, mode: Mode, withRetire: boolean, tag: string): Promise<Raced> {
  const barrier = join(dir, `barrier-${tag}`);
  const jobs: Array<{ role: "cite" | "retire"; target: string; idx: number }> = fx.specIds.map((id, idx) => ({ role: "cite", target: id, idx }));
  if (withRetire) jobs.push({ role: "retire", target: RULE_ID, idx: WRITERS });

  const procs = jobs.map((j) => {
    const ready = join(dir, `ready-${tag}-${j.idx}`);
    const resultPath = join(dir, `result-${tag}-${j.idx}.json`);
    const proc = Bun.spawn(
      ["bun", WORKER, fx.dbPath, j.role, j.target, ready, barrier, resultPath, mode, BRANCH_SLUG, `agent:race-${j.idx}`],
      { stdout: "pipe", stderr: "pipe" },
    );
    return { ...j, ready, resultPath, proc };
  });
  await Promise.all(procs.map((p) => waitForFile(p.ready, 20_000)));
  writeFileSync(barrier, "go");
  await Promise.all(procs.map((p) => p.proc.exited));

  const out: Raced = { cites: [], retire: null };
  for (const p of procs) {
    if (!existsSync(p.resultPath)) {
      const stderr = await new Response(p.proc.stderr).text();
      throw new Error(`${p.role} worker ${p.idx} wrote no result. stderr: ${stderr}`);
    }
    const res = JSON.parse(readFileSync(p.resultPath, "utf-8")) as WorkerResult;
    if (p.role === "retire") out.retire = res;
    else out.cites[p.idx] = res;
  }
  return out;
}

// ─── Observers (read the real store file; no mocks) ─────────────────────────

function citesOf(spec: DocRecord): string[] {
  const acs = spec.extra["acceptance_criteria"];
  if (!Array.isArray(acs)) return [];
  const hit = (acs as Array<{ id?: string; cites?: unknown }>).find((c) => c.id === AC_ID);
  return Array.isArray(hit?.cites) ? (hit.cites as string[]) : [];
}

async function readState(fx: Fixture) {
  const store = actedStore(new SQLiteStore(fx.dbPath));
  try {
    const specs: DocRecord[] = [];
    for (const id of fx.specIds) {
      const d = await store.find(id as never);
      if (!d.ok || d.value === null) throw new Error(`spec ${id} unreadable`);
      specs.push(d.value);
    }
    const leaf = await store.find(fx.leafId as never);
    if (!leaf.ok || leaf.value === null) throw new Error("leaf unreadable");
    const rule = ((leaf.value.extra["rules"] as Array<{ id: string; lifecycle: string }>) ?? []).find((r) => r.id === RULE_ID);

    const git = {} as never; // MOCK RISK: counts() is git-free per RuleStateService contract; any git call would throw loudly
    const status = await computeBaselineStatus(store, new RuleStateServiceImpl(store, git) as RuleStateService, () => true);
    if (!status.ok || status.value === null) throw new Error(`computeBaselineStatus failed: ${JSON.stringify(status)}`);

    const db: Database = store.getDatabase();
    let registryLifecycle: string | { missing: string };
    try {
      const row = db.query("SELECT lifecycle FROM rule_registry WHERE id = ?").get(RULE_ID) as { lifecycle: string } | null;
      registryLifecycle = row === null ? { missing: "no registry row" } : row.lifecycle;
    } catch (cause) {
      registryLifecycle = { missing: String(cause) };
    }
    let acCitesRows: Array<{ doc_id: string }> | { missing: string };
    try {
      acCitesRows = db.query("SELECT doc_id FROM ac_cites WHERE rule_id = ? AND ac_id = ?").all(RULE_ID, AC_ID) as Array<{ doc_id: string }>;
    } catch (cause) {
      acCitesRows = { missing: String(cause) };
    }
    return { specs, ruleLifecycle: rule?.lifecycle, status: status.value, registryLifecycle, acCitesRows };
  } finally {
    store.close();
  }
}

/** The QA-2 measure: criteria that cite a retired rule, are written, and are not counted as flagged. */
function unflaggedRetiredCitations(landedOnRetired: number, flagged: number): number {
  return Math.max(0, landedOnRetired - flagged);
}

// ─── Tests ──────────────────────────────────────────────────────────────────

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cite-retire-race-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("harness control (passes today - proves the 8-process harness can land writes)", () => {
  it("8 concurrent citers with NO retirer all land and the live rule is not flagged", async () => {
    const fx = await seed(dir);
    const raced = await race(dir, fx, "enforce", false, "control");
    expect(raced.cites.map((c) => c.ok)).toEqual(Array(WRITERS).fill(true));
    const state = await readState(fx);
    expect(state.specs.map((s) => citesOf(s))).toEqual(Array(WRITERS).fill([RULE_ID]));
    expect(state.ruleLifecycle).toBe("live");
    expect(state.status.cites_to_inactive).toBe(0);
  }, 60_000);
});

describe("enforce mode, armed branch: 8 citers race 1 retirer (QA-2 / D6)", () => {
  it(`over ${ROUNDS} fresh rounds, every criterion citing the retired rule is refused-or-flagged and the cite index and registry agree with the documents`, async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const rdir = join(dir, `round-${round}`);
      mkdirSync(rdir, { recursive: true });
      const fx = await seed(rdir);
      const raced = await race(rdir, fx, "enforce", true, `r${round}`);

      expect(raced.retire).toEqual({ ok: true });
      const state = await readState(fx);
      expect(state.ruleLifecycle).toBe("retired");

      const landed = state.specs.filter((s) => citesOf(s).includes(RULE_ID));
      // each worker outcome must match the stored doc: ok <=> cite present (refused => write absent)
      state.specs.forEach((s, i) => {
        const res = raced.cites[i];
        if (res === undefined) throw new Error(`no result for citer ${i}`);
        if (res.ok) expect(citesOf(s)).toEqual([RULE_ID]);
        else {
          expect(INFRA_CODES.has(res.code)).toBe(false); // a refusal is a gate decision, not infrastructure noise
          expect(citesOf(s)).toEqual([]);
        }
      });
      // the QA-2 measure
      expect(unflaggedRetiredCitations(landed.length, state.status.cites_to_inactive)).toBe(0);
      expect(state.status.cites_to_inactive).toBe(landed.length);
      // D6: the registry mirrors the lifecycle, and C5: the cite index mirrors the documents
      expect(state.registryLifecycle).toBe("retired");
      expect(Array.isArray(state.acCitesRows)).toBe(true);
      if (Array.isArray(state.acCitesRows)) {
        expect(state.acCitesRows.map((r) => r.doc_id).sort()).toEqual(landed.map((s) => s.id).sort());
      }
    }
  }, 180_000);

  it("a cite attempted strictly AFTER the retire committed is refused, writes nothing, and the spec stays unflagged-free", async () => {
    const fx = await seed(dir);
    const retired = await race(dir, { ...fx, specIds: [] }, "enforce", true, "retire-only");
    expect(retired.retire).toEqual({ ok: true });

    const store = actedStore(new SQLiteStore(fx.dbPath));
    const gated = new AcService(store, new RecordLockService(store, new GateEnforcer(undefined)), { citeGate: { mode: "enforce", armed_branches: [BRANCH_SLUG] } });
    const before = await store.find(fx.specIds[0] as never);
    const res = await gated.citeCriterion(fx.specIds[0] as string, AC_ID, [RULE_ID], {}, { by: "agent:late" });
    const after = await store.find(fx.specIds[0] as never);
    store.close();

    expect(res.ok).toBe(false);
    if (!res.ok) expect(INFRA_CODES.has(String(res.error.code))).toBe(false);
    expect(before.ok && after.ok && before.value?.version === after.value?.version).toBe(true);
    expect(after.ok && after.value !== null ? citesOf(after.value) : ["?"]).toEqual([]);
  }, 60_000);

  it("a branch that is NOT armed still accepts the cite (gate scope is per armed branch)", async () => {
    const fx = await seed(dir);
    await race(dir, { ...fx, specIds: [] }, "enforce", true, "retire-only");
    const store = actedStore(new SQLiteStore(fx.dbPath));
    const ungated = new AcService(store, new RecordLockService(store, new GateEnforcer(undefined)), { citeGate: { mode: "enforce", armed_branches: ["some-other-branch"] } });
    const res = await ungated.citeCriterion(fx.specIds[0] as string, AC_ID, [RULE_ID], {}, { by: "agent:late" });
    store.close();
    expect(res.ok).toBe(true);
  }, 60_000);
});

describe("report mode: the same race never refuses and flags every citing criterion", () => {
  it(`over ${ROUNDS} fresh rounds, all 8 cites land and each is counted in cites_to_inactive, with index and registry in step`, async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const rdir = join(dir, `round-${round}`);
      mkdirSync(rdir, { recursive: true });
      const fx = await seed(rdir);
      const raced = await race(rdir, fx, "report", true, `r${round}`);

      expect(raced.retire).toEqual({ ok: true });
      expect(raced.cites.map((c) => c.ok)).toEqual(Array(WRITERS).fill(true));
      const state = await readState(fx);
      expect(state.ruleLifecycle).toBe("retired");
      expect(state.specs.map((s) => citesOf(s))).toEqual(Array(WRITERS).fill([RULE_ID]));
      expect(state.status.cites_to_inactive).toBe(WRITERS);
      expect(state.registryLifecycle).toBe("retired");
      expect(Array.isArray(state.acCitesRows)).toBe(true);
      if (Array.isArray(state.acCitesRows)) expect(state.acCitesRows).toHaveLength(WRITERS);
    }
  }, 180_000);
});
