/**
 * AC-CT-3 (SPEC-143, corrected 2026-10-17 / R13) — a stamp-less record is classified by a
 * PER-CORPUS, append-only cutoff; the control half is mandatory.
 *
 * The cutoff is the id of the single `state-binding-armed` audit row, written once per corpus by
 * the arming step (`StateBindingService.arm`). There is no shipped literal. A corpus with no such
 * row is UNARMED and nothing in it is refused.
 *
 * Everything here runs through the REAL services over an `InMemoryStore` (a throwaway corpus; the
 * repo's own `.lore/` is never touched): rows are written by `recordVerifiedEvidence` (so the
 * server-written `recorded_corpus_rev` is exercised, not hand-set), the cutoff by the real arming
 * step, and the verdicts by the real `buildTaskAttestationInfos` + `attestationFloor` (plan-close)
 * and `TaskWorkflowService.done` (`lore done`).
 *
 * Halves (failure-first; every refusal has its accept control):
 *  (1) post-arming stamp-less row            -> REFUSED by attestationFloor (exact reason + field)
 *  (2) CONTROL: row at/below the arming row, or unarmed corpus -> ACCEPTED
 *  (3) both classes distinct in the stamp-verdict distribution; unbound reasons sum to unbound
 *  (4) post-arming DIRTY-tree row -> unbound/dirty_tree, REFUSED; committed-tree control STAMPED and
 *      ACCEPTED; a pre-arming dirty row stays legacy_unbound
 *  (5) `lore done` refuses an unbound-only task (exit 4), accepts legacy_unbound, accepts unarmed
 *  + R13: the arming step reports how many legacy rows would become unbound BEFORE arming.
 *
 * Falsifiers (each maps to a test below that fails if the mutation is made):
 *  (a) stampCurrency says `stamped` for an UNDEFINED stamp   -> "hasStamp false is never stamped"
 *  (b) the armed id read as 0                               -> control (2) refuses a legacy row
 *  (c) the armed row ignored                                -> half (1) accepts the unbound row
 *  (d) `lore done` ignores `unbound`                        -> half (5) archives the unbound task
 *  (e) a dirty stamp treated as `stamped`                   -> half (4) accepts the dirty row
 *
 * @spec_ref spec-corpus-truthfulness-a-verdict-must-carry-the-state-it AC-CT-3
 */

import { describe, it, expect } from "vitest";
import {
  classifyStampAxis,
  buildTaskAttestationInfos,
  STATE_BINDING_ARMED_ACTION,
  type CreateDocInput,
  type DeclaredScopeCoverage,
  type DocRecord,
  type EvidenceEntry,
  type TaskAttestationInfo,
} from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { AuditService } from "../../../src/service/audit-service.js";
import {
  TaskWorkflowService,
  type VerifiedEvidenceInput,
} from "../../../src/service/task-workflow-service.js";
import { StateBindingService } from "../../../src/service/state-binding-service.js";
import { loadStampBindingContext } from "../../../src/service/stamp-binding-reader.js";
import { stampCurrency } from "../../../src/service/gate-predicates.js";
import { ATTESTATION_FLOOR_FIELD, ATTESTATION_FLOOR_REASON, attestationFloor } from "../../helpers/attestation-floor-stand-in.js";
import { exitCode } from "../../../src/adapters/cli/utils.js";
import { actedStore } from "../../live-invocation.js";

import { fakeWorktreeProbe } from "../../helpers/fake-worktree-probe.js";
// ─── Harness ────────────────────────────────────────────────────────────────

const NOW = "2026-10-17T10:00:00.000Z";
const HEAD = "7ab1d742c0f9e1b6a3d5c8e2f4b7a9d0c1e3f5a7";

function makeCorpus() {
  const store = actedStore(new InMemoryStore());
  const corpus = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const tasks = new TaskWorkflowService(store, undefined, { claimTtlMinutes: 120 }, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, fakeWorktreeProbe());
  const binding = new StateBindingService(store);
  return { store, corpus, tasks, binding };
}
type Corpus = ReturnType<typeof makeCorpus>;

async function createTask(c: Corpus, title: string): Promise<DocRecord> {
  const plan = await c.corpus.create({ type: "plan", title: `Plan ${title}`, content: "body" } as CreateDocInput);
  if (!plan.ok) throw new Error(`plan create failed: ${JSON.stringify(plan.error)}`);
  const task = await c.corpus.create({
    type: "task",
    title,
    parent_id: plan.value.id,
    content: "body",
    extra: { plan_id: plan.value.id },
  } as CreateDocInput);
  if (!task.ok) throw new Error(`task create failed: ${JSON.stringify(task.error)}`);
  return task.value;
}

type Attestation = NonNullable<VerifiedEvidenceInput["attestation"]>;

/** A runner-attested pass. `attestation` carries whatever stamp facts the case needs. */
function attestedPass(extraAttestation: Partial<Attestation> = {}): VerifiedEvidenceInput {
  return {
    oracle: "tsc",
    command: "bun run typecheck",
    result: "pass",
    recorded_by: "runner",
    capture_source: "runner",
    attestation: { runner: "lore-cli", exit_code: 0, duration_ms: 1, timed_out: false, ...extraAttestation },
  };
}

const STAMPED: Partial<Attestation> = { state_stamp: { head_sha: HEAD, worktree_dirty: false } };
const DIRTY: Partial<Attestation> = { stamp_unbound_reason: "dirty_tree" };

async function record(c: Corpus, task: DocRecord, entry: VerifiedEvidenceInput): Promise<DocRecord> {
  const written = await c.tasks.recordVerifiedEvidence(task.id, entry, NOW);
  if (!written.ok) throw new Error(`record failed: ${JSON.stringify(written.error)}`);
  return written.value;
}

async function arm(c: Corpus): Promise<number> {
  const armed = await c.binding.arm({ actor: "agent:test", nowIso: NOW });
  if (!armed.ok) throw new Error(`arm failed: ${JSON.stringify(armed.error)}`);
  return armed.value.arming_rev;
}

async function refetch(c: Corpus, id: string): Promise<DocRecord> {
  const found = await c.store.find(id);
  if (!found.ok || found.value === null) throw new Error("refetch failed");
  return found.value;
}

/** The plan-close wiring's exact derivation: the binding context, then the counting SSOT. */
async function infosFor(c: Corpus, tasks: readonly DocRecord[]): Promise<TaskAttestationInfo[]> {
  const binding = await loadStampBindingContext(c.store, tasks);
  if (!binding.ok) throw new Error(`binding load failed: ${JSON.stringify(binding.error)}`);
  return buildTaskAttestationInfos(tasks, binding.value);
}

const SCOPE_OK: DeclaredScopeCoverage = {
  declared_acs: ["AC-1"],
  unattested_acs: [],
  scope_undeclared: false,
  meets_coverage: true,
};

/** `attestationFloor` with every OTHER conjunct satisfied, so the stamp axis alone decides. */
function floorVerdict(infos: readonly TaskAttestationInfo[]) {
  return attestationFloor(infos, null, "plan-x", [], SCOPE_OK);
}

// ─── Half (1) + (2): the cutoff and its mandatory control ───────────────────

describe("AC-CT-3 halves 1+2: the per-corpus arming row separates refused from accepted", () => {
  it("(1) a stamp-less attested row recorded ABOVE the armed audit id is REFUSED by attestationFloor with the exact floor reason and field", async () => {
    const c = makeCorpus();
    const task = await createTask(c, "above");
    await arm(c);
    const after = await record(c, task, attestedPass());

    const verdict = floorVerdict(await infosFor(c, [after]));

    expect(verdict).toEqual({ ok: false, reason: ATTESTATION_FLOOR_REASON, field: ATTESTATION_FLOOR_FIELD });
    expect(ATTESTATION_FLOOR_REASON).toBe("ATTESTATION_FLOOR_NOT_MET");
    expect(ATTESTATION_FLOOR_FIELD).toBe("attestation-floor");
  });

  it("(2) CONTROL: a stamp-less row recorded BELOW the armed audit id is ACCEPTED by the same floor", async () => {
    const c = makeCorpus();
    const task = await createTask(c, "below");
    const before = await record(c, task, attestedPass());
    await arm(c);

    const infos = await infosFor(c, [await refetch(c, before.id)]);

    expect(floorVerdict(infos)).toEqual({ ok: true });
    expect(infos[0]?.stampTally?.legacy_unbound).toBe(1);
    expect(infos[0]?.stampTally?.unbound).toBe(0);
  });

  it("(2) CONTROL: the same stamp-less row in an UNARMED corpus is ACCEPTED, and no per-doc audit read is needed", async () => {
    const c = makeCorpus();
    const task = await createTask(c, "unarmed");
    const written = await record(c, task, attestedPass());

    const binding = await loadStampBindingContext(c.store, [written]);
    expect(binding.ok && binding.value.armingRev).toBeUndefined();
    expect(binding.ok && binding.value.evidenceAuditIdsByDoc.size).toBe(0);
    expect(floorVerdict(await infosFor(c, [written]))).toEqual({ ok: true });
  });

  it("(2) the row AT the arming boundary: the last row written before arming is legacy, the first after is unbound", async () => {
    const c = makeCorpus();
    const task = await createTask(c, "boundary");
    await record(c, task, attestedPass());
    await arm(c);
    await record(c, task, attestedPass({ exit_code: 0, duration_ms: 2 }));

    const infos = await infosFor(c, [await refetch(c, task.id)]);

    expect(infos[0]?.stampTally).toMatchObject({ legacy_unbound: 1, unbound: 1, stamped: 0 });
    // One legacy row keeps the task acceptable: only an UNBOUND-ONLY task is refused.
    expect(floorVerdict(infos)).toEqual({ ok: true });
  });

  it("(c) the arming row is what refuses: the identical post-arming row in a corpus whose arming row is absent is accepted", async () => {
    const armed = makeCorpus();
    const unarmed = makeCorpus();
    const a = await createTask(armed, "same");
    const u = await createTask(unarmed, "same");
    await arm(armed);
    const rowA = await record(armed, a, attestedPass());
    const rowU = await record(unarmed, u, attestedPass());

    expect(floorVerdict(await infosFor(armed, [rowA]))).toMatchObject({ ok: false });
    expect(floorVerdict(await infosFor(unarmed, [rowU]))).toEqual({ ok: true });
  });

  it("(b) an armed id read as 0 would refuse the back-catalogue: the legacy control row must be classified against the REAL armed id", async () => {
    const c = makeCorpus();
    const task = await createTask(c, "zero");
    const before = await record(c, task, attestedPass());
    const armedAt = await arm(c);
    expect(armedAt).toBeGreaterThan(0);

    const binding = await loadStampBindingContext(c.store, [await refetch(c, before.id)]);
    if (!binding.ok) throw new Error("binding load failed");
    expect(binding.value.armingRev).toBe(armedAt);
    // Re-classify the same row against the falsifier value 0: it flips to unbound.
    const audit = binding.value.evidenceAuditIdsByDoc.get(before.id) ?? [];
    expect(classifyStampAxis({ armingRev: 0, hasStamp: false, runnerReason: undefined, recordedAuditId: audit[0] }).stamp).toBe("unbound");
    expect(classifyStampAxis({ armingRev: armedAt, hasStamp: false, runnerReason: undefined, recordedAuditId: audit[0] }).stamp).toBe("legacy_unbound");
  });

  it("(a) a row with NO stamp is never `stamped` (stampCurrency reads the flag, not a default)", () => {
    for (const armingRev of [undefined, 0, 5, 1_000_000]) {
      const currency = stampCurrency(
        { armingRev, hasStamp: false, runnerReason: undefined, recordedAuditId: 3 },
        { status: "unmeasured" },
      );
      expect(currency.stamp).not.toBe("stamped");
    }
    expect(
      stampCurrency({ armingRev: 5, hasStamp: true, runnerReason: undefined, recordedAuditId: 9 }, { status: "unmeasured" }).stamp,
    ).toBe("stamped");
  });
});

// ─── The audit id of a row ──────────────────────────────────────────────────

describe("AC-CT-3: a row's audit id is its server-written recorded_corpus_rev, else the evidence audit join; neither is unbound/audit_id_unresolved", () => {
  it("every evidence write stores recorded_corpus_rev = MAX(audit.id) at write time, and a caller-supplied value is refused", async () => {
    const c = makeCorpus();
    const task = await createTask(c, "rev");
    const head = await c.store.getAuditHeadId();
    if (!head.ok) throw new Error("head read failed");

    const written = await record(c, task, attestedPass());
    const row = (written.extra["verification_evidence"] as EvidenceEntry[])[0];
    expect(row?.recorded_corpus_rev).toBe(head.value);

    const smuggled = await c.tasks.recordVerifiedEvidence(
      task.id,
      { ...attestedPass(), recorded_corpus_rev: 0 } as VerifiedEvidenceInput,
      NOW,
    );
    expect(smuggled.ok).toBe(false);
    if (smuggled.ok) return;
    expect(smuggled.error).toMatchObject({ code: "VALIDATION_ERROR", field: "recorded_corpus_rev" });
  });

  it("a row with neither a recorded rev nor an evidence audit row, in an armed corpus, is unbound/audit_id_unresolved and counted", async () => {
    const c = makeCorpus();
    const plan = await c.corpus.create({ type: "plan", title: "Plan legacy", content: "b" } as CreateDocInput);
    if (!plan.ok) throw new Error("plan");
    const legacyRow = {
      oracle: "tsc",
      command: "bun run typecheck",
      result: "pass",
      recorded_at: "2026-01-01T00:00:00.000Z",
      recorded_by: "runner",
      capture_source: "runner",
      attestation: { runner: "lore-cli", exit_code: 0, duration_ms: 1, timed_out: false },
    };
    const created = await c.corpus.create({
      type: "task",
      title: "Legacy no audit row",
      parent_id: plan.value.id,
      content: "b",
      extra: { plan_id: plan.value.id, verification_evidence: [legacyRow] },
    } as CreateDocInput);
    if (!created.ok) throw new Error(`task: ${JSON.stringify(created.error)}`);
    await arm(c);

    const infos = await infosFor(c, [created.value]);

    expect(infos[0]?.stampTally).toMatchObject({ unbound: 1, unbound_reasons: { audit_id_unresolved: 1 } });
    expect(floorVerdict(infos)).toMatchObject({ ok: false, reason: ATTESTATION_FLOOR_REASON });
  });

  it("the evidence audit join resolves a row that carries no recorded_corpus_rev (legacy shape written before the field existed)", async () => {
    const c = makeCorpus();
    const task = await createTask(c, "join");
    const written = await record(c, task, attestedPass());
    // Strip the server-written rev to reproduce a pre-field row; the audit row still exists.
    const rows = (written.extra["verification_evidence"] as EvidenceEntry[]).map((r) => {
      const { recorded_corpus_rev: _dropped, ...rest } = r;
      return rest;
    });
    const upd = await c.store.update(task.id, { extra: { ...written.extra, verification_evidence: rows } });
    if (!upd.ok) throw new Error("strip failed");
    await arm(c);

    const infos = await infosFor(c, [await refetch(c, task.id)]);

    expect(infos[0]?.stampTally).toMatchObject({ legacy_unbound: 1, unbound: 0 });
  });
});

// ─── Half (3): the stamp-verdict distribution ───────────────────────────────

describe("AC-CT-3 half 3: unbound and legacy_unbound appear distinctly in the stamp-verdict distribution", () => {
  it("one stamped, one legacy_unbound, one unbound row are three distinct counts, and unbound reasons sum to unbound", async () => {
    const c = makeCorpus();
    const task = await createTask(c, "dist");
    await record(c, task, attestedPass());
    await arm(c);
    await record(c, task, attestedPass(STAMPED));
    await record(c, task, attestedPass());
    await record(c, task, attestedPass(DIRTY));

    const tally = (await infosFor(c, [await refetch(c, task.id)]))[0]?.stampTally;

    // AC-CT-9 grew the tally with the radius axis of STAMPED rows; no diff port here, so the one stamped row is
    // radius_unmeasured (accepted), never bound.
    expect(tally).toEqual({
      stamped: 1,
      bound: 0,
      stale: 0,
      radius_unmeasured: 1,
      legacy_unbound: 1,
      unbound: 2,
      unbound_reasons: { dirty_tree: 1, state_moved: 0, audit_id_unresolved: 0, no_stamp: 1 },
    });
    const reasons = Object.values(tally?.unbound_reasons ?? {}).reduce((a, b) => a + b, 0);
    expect(reasons).toBe(tally?.unbound);
  });
});

// ─── Half (4): dirty tree ───────────────────────────────────────────────────

describe("AC-CT-3 half 4: a post-arming dirty-tree row is unbound/dirty_tree and refused; the committed-tree control is stamped and accepted", () => {
  it("(e) a dirty-tree post-arming row is REFUSED and counted under dirty_tree", async () => {
    const c = makeCorpus();
    const task = await createTask(c, "dirty");
    await arm(c);
    await record(c, task, attestedPass(DIRTY));

    const infos = await infosFor(c, [await refetch(c, task.id)]);

    expect(infos[0]?.stampTally).toMatchObject({ unbound: 1, unbound_reasons: { dirty_tree: 1, no_stamp: 0 } });
    expect(floorVerdict(infos)).toEqual({ ok: false, reason: ATTESTATION_FLOOR_REASON, field: ATTESTATION_FLOOR_FIELD });
  });

  it("CONTROL: the same row on a committed tree carries a stamp, reads `stamped`, and is ACCEPTED", async () => {
    const c = makeCorpus();
    const task = await createTask(c, "committed");
    await arm(c);
    await record(c, task, attestedPass(STAMPED));

    const infos = await infosFor(c, [await refetch(c, task.id)]);

    expect(infos[0]?.stampTally).toMatchObject({ stamped: 1, unbound: 0 });
    expect(floorVerdict(infos)).toEqual({ ok: true });
  });

  it("a PRE-arming dirty row stays legacy_unbound and is accepted", async () => {
    const c = makeCorpus();
    const task = await createTask(c, "dirty-before");
    await record(c, task, attestedPass(DIRTY));
    await arm(c);

    const infos = await infosFor(c, [await refetch(c, task.id)]);

    expect(infos[0]?.stampTally).toMatchObject({ legacy_unbound: 1, unbound: 0 });
    expect(floorVerdict(infos)).toEqual({ ok: true });
  });
});

// ─── Half (5): lore done ────────────────────────────────────────────────────

describe("AC-CT-3 half 5: lore done's per-task floor refuses an unbound-only task, accepts legacy_unbound, and refuses nothing in an unarmed corpus", () => {
  it("(d) an unbound-only task is REFUSED: VALIDATION_ERROR on extra.verification_evidence, floor attested-pass, CLI exit 4, naming the reason", async () => {
    const c = makeCorpus();
    const task = await createTask(c, "done-unbound");
    await arm(c);
    await record(c, task, attestedPass(DIRTY));

    const done = await c.tasks.done(task.id, { by: "alice" });

    expect(done.ok).toBe(false);
    if (done.ok) return;
    expect(done.error.code).toBe("VALIDATION_ERROR");
    expect((done.error as { field?: string }).field).toBe("extra.verification_evidence");
    expect((done.error as { details?: { floor?: string } }).details?.floor).toBe("attested-pass");
    expect((done.error as { message: string }).message).toContain("dirty_tree");
    expect(exitCode(done.error)).toBe(4);
    expect((await refetch(c, task.id)).status).not.toBe("archived");
  });

  it("CONTROL: a task whose only attested pass is legacy_unbound ARCHIVES", async () => {
    const c = makeCorpus();
    const task = await createTask(c, "done-legacy");
    await record(c, task, attestedPass());
    await arm(c);

    const done = await c.tasks.done(task.id, { by: "alice" });

    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.value.task.status).toBe("archived");
  });

  it("CONTROL: an UNARMED corpus refuses nothing — the same stamp-less row archives", async () => {
    const c = makeCorpus();
    const task = await createTask(c, "done-unarmed");
    await record(c, task, attestedPass());

    const done = await c.tasks.done(task.id, { by: "alice" });

    expect(done.ok).toBe(true);
  });

  it("CONTROL: a stamped post-arming pass archives, and one stamped row rescues a task that also holds an unbound one", async () => {
    const c = makeCorpus();
    const task = await createTask(c, "done-stamped");
    await arm(c);
    await record(c, task, attestedPass(DIRTY));
    await record(c, task, attestedPass(STAMPED));

    const done = await c.tasks.done(task.id, { by: "alice" });

    expect(done.ok).toBe(true);
  });

  it("checkDoneFloors (the cascade/archive-sweep copy) refuses the same unbound-only task with the same floor", async () => {
    const c = makeCorpus();
    const task = await createTask(c, "floors-unbound");
    await arm(c);
    await record(c, task, attestedPass());

    const floors = await c.tasks.checkDoneFloors(task.id);

    expect(floors.ok).toBe(true);
    if (!floors.ok) return;
    expect(floors.value?.floor).toBe("attested-pass");
  });
});

// ─── The arming step ────────────────────────────────────────────────────────

describe("AC-CT-3 R13: the arming step reports the legacy rows that would become unbound, before arming", () => {
  /** Two docs whose attested rows have no audit trail (the measured 98-rows-in-36-docs shape), one clean doc. */
  async function seedLegacyCorpus(c: Corpus) {
    const plan = await c.corpus.create({ type: "plan", title: "Plan legacy", content: "b" } as CreateDocInput);
    if (!plan.ok) throw new Error("plan");
    const attested = (n: number) => ({
      oracle: "tsc",
      command: `bun run typecheck ${n}`,
      result: "pass",
      recorded_at: "2026-01-01T00:00:00.000Z",
      recorded_by: "runner",
      capture_source: "runner",
      attestation: { runner: "lore-cli", exit_code: 0, duration_ms: 1, timed_out: false },
    });
    const selfReport = {
      oracle: "manual",
      command: "looked at it",
      result: "pass",
      recorded_at: "2026-01-01T00:00:00.000Z",
      recorded_by: "alice",
      capture_source: "self-report",
      output_tail: "hand typed",
    };
    for (const [title, rows] of [
      ["Legacy A", [attested(1), attested(2), selfReport]],
      ["Legacy B", [attested(3)]],
    ] as const) {
      const made = await c.corpus.create({
        type: "task",
        title,
        parent_id: plan.value.id,
        content: "b",
        extra: { plan_id: plan.value.id, verification_evidence: [...rows] },
      } as CreateDocInput);
      if (!made.ok) throw new Error(`seed: ${JSON.stringify(made.error)}`);
    }
    const clean = await createTask(c, "Clean with audit trail");
    await record(c, clean, attestedPass());
  }

  it("reports exactly the rows with no resolvable audit id (3 attested rows in 2 docs; the self-report is unresolved but not attested), writing NOTHING", async () => {
    const c = makeCorpus();
    await seedLegacyCorpus(c);
    const headBefore = await c.store.getAuditHeadId();

    const report = await c.binding.reportImpact();

    expect(report.ok).toBe(true);
    if (!report.ok) return;
    expect(report.value).toMatchObject({
      docs_with_evidence: 3,
      evidence_rows: 5,
      attested_rows: 4,
      unresolved_evidence_rows: 4,
      would_become_unbound_rows: 3,
      would_become_unbound_docs: 2,
    });
    expect(report.value.would_become_unbound_slugs).toHaveLength(2);
    expect(await c.store.getAuditHeadId()).toEqual(headBefore);
  });

  it("arm writes ONE non-doc state-binding-armed audit row carrying the report, returns its id, and the hash chain stays clean", async () => {
    const c = makeCorpus();
    await seedLegacyCorpus(c);

    const armed = await c.binding.arm({ actor: "agent:test", nowIso: NOW });

    expect(armed.ok).toBe(true);
    if (!armed.ok || armed.value.status !== "armed") throw new Error("expected armed");
    expect(armed.value.report.would_become_unbound_rows).toBe(3);
    const rows = await c.store.listAuditRowsByAction(STATE_BINDING_ARMED_ACTION);
    if (!rows.ok) throw new Error("rows");
    expect(rows.value).toHaveLength(1);
    expect(rows.value[0]?.id).toBe(armed.value.arming_rev);
    expect(rows.value[0]?.doc_id ?? null).toBeNull();
    expect(rows.value[0]?.details).toMatchObject({ would_become_unbound_rows: 3, would_become_unbound_docs: 2 });

    const verified = await new AuditService(c.store).verify({});
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.value.chain.clean).toBe(true);
  });

  it("arming turns exactly those legacy rows unbound once armed, and plan-close's floor refuses the unbound-only task", async () => {
    const c = makeCorpus();
    await seedLegacyCorpus(c);
    await arm(c);
    const all = await c.store.findMany({ type: "task" });
    if (!all.ok) throw new Error("tasks");

    const infos = await infosFor(c, all.value);
    const unbound = infos.reduce((n, i) => n + (i.stampTally?.unbound ?? 0), 0);

    expect(unbound).toBe(3);
    expect(floorVerdict(infos)).toMatchObject({ ok: false, field: ATTESTATION_FLOOR_FIELD });
  });

  it("is idempotent: a second arm writes nothing and reports the existing cutoff; a later forged row never moves the cutoff", async () => {
    const c = makeCorpus();
    const first = await arm(c);
    const headAfterFirst = await c.store.getAuditHeadId();

    const again = await c.binding.arm({ actor: "agent:test", nowIso: NOW });

    expect(again.ok && again.value).toEqual({ status: "already_armed", arming_rev: first });
    expect(await c.store.getAuditHeadId()).toEqual(headAfterFirst);

    await c.store.appendAuditEntry({
      timestamp: NOW,
      actor: "agent:forger",
      session_id: "x",
      action: STATE_BINDING_ARMED_ACTION,
    });
    const task = await createTask(c, "after-forged");
    const written = await record(c, task, attestedPass());
    const binding = await loadStampBindingContext(c.store, [written]);
    expect(binding.ok && binding.value.armingRev).toBe(first);
  });
});
