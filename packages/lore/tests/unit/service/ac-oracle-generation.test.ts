/**
 * AC oracle generations — spec-the-defect-channel-cannot-be-honestly-maintained-an §M5,
 * AC-DC-8. Rewriting a script-mode AC's `verify.command` starts a NEW ORACLE GENERATION;
 * evidence recorded under a retired oracle is reported as PRIOR-generation, and NOT ONE
 * stored evidence row is edited, deleted, or hidden to make that true.
 *
 * The measured defect this closes (spec §F3): `AC-BG-5` in a consumer corpus carried 7
 * evidence rows across two MUTUALLY EXCLUSIVE commands — `grep -rq MARKER apps/web`
 * (marker MUST exist) and `! grep -rq MARKER …` (marker MUST NOT exist) — two of them
 * BOTH attested `exit_code: 0`. `deriveAcCoverageState`'s pre-existing `fail_superseded`
 * keys on a FAIL superseded by a newer ATTESTED PASS, so it structurally cannot see two
 * PASSES of opposite polarity: the pair read as ordinary green.
 *
 * Dimension mapping:
 *   HAPPY:      a command rewrite bumps `oracle_generation` (absent → 2) and
 *               `computeAcCoverage` splits the criterion's rows into current- vs
 *               prior-generation; BOTH write paths (self-reported `addEvidence`,
 *               runner-attested `recordVerifiedEvidence`) stamp the in-force generation
 *   NEGATIVE:   re-setting the SAME command does not bump (idempotent); a
 *               statement-only edit does not bump and never invents a generation
 *   BOUNDARY:   an ABSENT `oracle_generation` reads as generation 1 (the whole
 *               pre-mechanism back-catalogue), so a never-rewritten criterion reports
 *               zero prior-generation rows; `oracle_generation`/`ac_oracle_generation`
 *               are refused at 0 and at 1.5 by the schema layer
 *   ERROR:      a CALLER-supplied `ac_oracle_generation` is refused loud on both write
 *               paths and writes nothing; a bogus `ac_ref` is still refused (so a row
 *               can never be committed with an unresolvable — hence unstampable — ref)
 *   STATE:      three successive rewrites are monotonic (2 → 3 → 4), never reuse a
 *               number, and `prior_refs` accumulates across them
 *   REGRESSION: every stored evidence row is BYTE-IDENTICAL across the bump (SHA of the
 *               serialized rows, with a sensitivity control proving the hash can differ);
 *               `deriveAcCoverageState`'s seven states are untouched by the new facts; a
 *               row with no `ac_ref` is never stamped; a legacy all-unstamped log counts
 *               exactly as it did before
 *
 * reason: the criterion/fact/row generation fields are read STRUCTURALLY here (via
 * `asRecord`), never as direct typed field accesses, and this file imports NO symbol that
 * did not already exist before §M5. That is deliberate and load-bearing for the red-first
 * discipline (`~/.claude/skills/shared/verification-discipline.md`): a test that imports a
 * not-yet-written export fails at MODULE LOAD, which proves nothing about behaviour — this
 * file's pre-implementation failure mode is an ASSERTION mismatch on every case. Do not
 * "clean up" the structural reads into typed field access.
 *
 * @spec_ref AC-DC-8
 */

import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  computeAcCoverage,
  deriveAcCoverageState,
  evidenceEntrySchema,
  specAcceptanceCriteriaSchema,
} from "@lore/core";
import type { AcCoverageFact, AcceptanceCriterion, CreateDocInput, DocRecord } from "@lore/core";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { AcService } from "../../../src/service/ac-service.js";
import {
  TaskWorkflowService,
  type EvidenceInput,
  type VerifiedEvidenceInput,
} from "../../../src/service/task-workflow-service.js";

// ─── Fixtures ───────────────────────────────────────────────────────────────

const AC_ID = "AC-BG-5";
/** The original oracle: the marker MUST exist. */
const MARKER_PRESENT_COMMAND = "grep -rq LORE_ORACLE_MARKER apps/web";
/** The polarity-REVERSED oracle: the marker MUST NOT exist. Same id, opposite meaning. */
const MARKER_ABSENT_COMMAND = "! grep -rq LORE_ORACLE_MARKER apps/web";

interface Fixture {
  store: InMemoryStore;
  corpusService: CorpusService;
  acService: AcService;
  taskWorkflowService: TaskWorkflowService;
  specId: string;
  planId: string;
  taskId: string;
}

function makeServices(): {
  store: InMemoryStore;
  corpusService: CorpusService;
  acService: AcService;
  taskWorkflowService: TaskWorkflowService;
} {
  const store = new InMemoryStore();
  const corpusService = new CorpusService(store);
  const acService = new AcService(store);
  const taskWorkflowService = new TaskWorkflowService(
    store,
    undefined,
    { claimTtlMinutes: 120 },
    corpusService.resolveDeclaredAcIds.bind(corpusService),
    undefined,
    undefined,
    undefined,
    // reason: task-widen-the-declared-ac-port-to-carry-criteria-so-the — the
    // generation-carrying sibling of the 4th arg. `resolveAcOracleGeneration` now
    // reads the criterion (and its oracle_generation) from THIS port rather than a
    // private traversal of its own, so this fixture must wire it for the stamping
    // this whole file asserts on to happen at all.
    corpusService.resolveDeclaredAcCriteria.bind(corpusService),
  );
  return { store, corpusService, acService, taskWorkflowService };
}

async function createDoc(cs: CorpusService, input: CreateDocInput): Promise<string> {
  const result = await cs.create(input);
  if (!result.ok) throw new Error(`fixture create failed: ${JSON.stringify(result.error)}`);
  return result.value.id;
}

/** prd → spec (one script-mode AC, command = {@link MARKER_PRESENT_COMMAND}) → plan → task. */
async function makeFixture(command: string = MARKER_PRESENT_COMMAND): Promise<Fixture> {
  const services = makeServices();
  const { corpusService, acService } = services;
  const prdId = await createDoc(corpusService, {
    type: "prd",
    title: "Oracle Generation PRD",
    content: "root",
  } as CreateDocInput);
  const specId = await createDoc(corpusService, {
    type: "spec",
    title: "Oracle Generation Spec",
    parent_id: prdId,
    content: "spec body",
  } as CreateDocInput);
  const planId = await createDoc(corpusService, {
    type: "plan",
    title: "Oracle Generation Plan",
    parent_id: specId,
    content: "plan body",
  } as CreateDocInput);
  const taskId = await createDoc(corpusService, {
    type: "task",
    title: "Oracle Generation Task",
    parent_id: planId,
    content: "task body",
    extra: { plan_id: planId },
  } as CreateDocInput);

  const added = await acService.addCriterion(specId, {
    id: AC_ID,
    statement: `A grep over apps/web for LORE_ORACLE_MARKER exits ${command.startsWith("!") ? "1" : "0"}`,
    verify: { mode: "script", oracle: "test", command },
  });
  if (!added.ok) throw new Error(`fixture addCriterion failed: ${JSON.stringify(added.error)}`);

  return { ...services, specId, planId, taskId };
}

// ─── Structural readers (see this file's header `reason:` note) ──────────────

function asRecord(value: unknown): Record<string, unknown> {
  return value as unknown as Record<string, unknown>;
}

/** The criterion's declared `oracle_generation`, read structurally — `undefined` when never bumped. */
function declaredGeneration(criterion: AcceptanceCriterion): unknown {
  return asRecord(criterion)["oracle_generation"];
}

/** `computeAcCoverage`'s per-AC generation split, read structurally. */
function generationSplit(fact: AcCoverageFact): Record<string, unknown> | undefined {
  const raw = asRecord(fact)["oracle_generation"];
  return typeof raw === "object" && raw !== null ? asRecord(raw) : undefined;
}

/** One stored evidence row's `ac_oracle_generation` stamp, read structurally. */
function rowGeneration(row: unknown): unknown {
  return asRecord(row)["ac_oracle_generation"];
}

// ─── Store helpers ──────────────────────────────────────────────────────────

async function readTask(store: InMemoryStore, taskId: string): Promise<DocRecord> {
  const found = await store.find(taskId);
  if (!found.ok || found.value === null) throw new Error("task fetch failed");
  return found.value;
}

async function readEvidenceRows(store: InMemoryStore, taskId: string): Promise<unknown[]> {
  const task = await readTask(store, taskId);
  const raw = task.extra["verification_evidence"];
  return Array.isArray(raw) ? raw : [];
}

async function readCriterion(acService: AcService, specId: string): Promise<AcceptanceCriterion> {
  const listed = await acService.listCriteria(specId);
  if (!listed.ok) throw new Error(`listCriteria failed: ${JSON.stringify(listed.error)}`);
  const criterion = listed.value.criteria.find((c) => c.id === AC_ID);
  if (criterion === undefined) throw new Error(`criterion ${AC_ID} missing`);
  return criterion;
}

/** SHA-256 over the serialized evidence log — the byte-identity oracle AC-DC-8 mandates. */
function hashRows(rows: readonly unknown[]): string {
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

// ─── Evidence writers ───────────────────────────────────────────────────────

/**
 * reason: `null` (never `undefined`) is the "omit ac_ref" sentinel — a DEFAULT PARAMETER
 * fires on an explicitly-passed `undefined`, so an `acRef?: string = AC_ID` signature
 * silently re-added `ac_ref: AC_ID` to the very row the no-ac_ref case exists to test,
 * and that case measured nothing until this sentinel replaced it.
 */
async function recordAttestedPass(
  fixture: Fixture,
  command: string,
  nowIso: string,
  acRef: string | null = AC_ID,
): Promise<void> {
  const entry = {
    oracle: "test",
    command,
    result: "pass",
    recorded_by: "agent:oracle-generation",
    capture_source: "runner",
    output_tail: "1 passed",
    ...(acRef !== null ? { ac_ref: acRef } : {}),
    attestation: { runner: "lore-cli", exit_code: 0, duration_ms: 12, timed_out: false },
  } as unknown as VerifiedEvidenceInput;
  const result = await fixture.taskWorkflowService.recordVerifiedEvidence(fixture.taskId, entry, nowIso);
  if (!result.ok) throw new Error(`recordVerifiedEvidence failed: ${JSON.stringify(result.error)}`);
}

/** Same `null`-sentinel contract as {@link recordAttestedPass} — see its own reason note. */
async function recordSelfReportedRed(
  fixture: Fixture,
  command: string,
  nowIso: string,
  acRef: string | null = AC_ID,
): Promise<void> {
  const entry = {
    oracle: "test",
    command,
    result: "expected-fail",
    recorded_by: "agent:oracle-generation",
    capture_source: "self-report",
    output_tail: "1 failed — red-first run",
    ...(acRef !== null ? { ac_ref: acRef } : {}),
  } as unknown as EvidenceInput;
  const result = await fixture.taskWorkflowService.addEvidence(fixture.taskId, entry, () => nowIso);
  if (!result.ok) throw new Error(`addEvidence failed: ${JSON.stringify(result.error)}`);
}

async function rewriteCommand(fixture: Fixture, command: string): Promise<AcceptanceCriterion> {
  const result = await fixture.acService.setCriterion(fixture.specId, AC_ID, { command });
  if (!result.ok) throw new Error(`setCriterion failed: ${JSON.stringify(result.error)}`);
  return readCriterion(fixture.acService, fixture.specId);
}

async function coverageFact(fixture: Fixture): Promise<AcCoverageFact> {
  const criterion = await readCriterion(fixture.acService, fixture.specId);
  const task = await readTask(fixture.store, fixture.taskId);
  const facts = computeAcCoverage([criterion], [task]);
  const fact = facts[0];
  if (fact === undefined) throw new Error("computeAcCoverage returned no fact");
  return fact;
}

// ─── HAPPY ──────────────────────────────────────────────────────────────────

describe("AC-DC-8 · oracle generation bump + prior-generation reporting (HAPPY)", () => {
  it("bumps oracle_generation on a command rewrite and reports the pre-bump rows as prior-generation", async () => {
    const fixture = await makeFixture();
    await recordAttestedPass(fixture, MARKER_PRESENT_COMMAND, "2026-08-11T10:00:00.000Z");
    await recordSelfReportedRed(fixture, MARKER_PRESENT_COMMAND, "2026-08-11T10:05:00.000Z");

    const before = await readCriterion(fixture.acService, fixture.specId);
    expect(declaredGeneration(before)).toBeUndefined();

    const after = await rewriteCommand(fixture, MARKER_ABSENT_COMMAND);
    expect(declaredGeneration(after)).toBe(2);

    // The reversed oracle now records its own pass — the F3 shape: two attested passes,
    // opposite polarity, side by side.
    await recordAttestedPass(fixture, MARKER_ABSENT_COMMAND, "2026-08-11T11:00:00.000Z");

    const fact = await coverageFact(fixture);
    expect(fact.refs).toHaveLength(3);
    expect(generationSplit(fact)).toEqual({ current: 2, current_refs: 1, prior_refs: 2 });
  });

  it("stamps the in-force generation on BOTH write paths (self-reported and runner-attested)", async () => {
    const fixture = await makeFixture();
    await recordAttestedPass(fixture, MARKER_PRESENT_COMMAND, "2026-08-11T10:00:00.000Z");
    await recordSelfReportedRed(fixture, MARKER_PRESENT_COMMAND, "2026-08-11T10:05:00.000Z");
    await rewriteCommand(fixture, MARKER_ABSENT_COMMAND);
    await recordAttestedPass(fixture, MARKER_ABSENT_COMMAND, "2026-08-11T11:00:00.000Z");
    await recordSelfReportedRed(fixture, MARKER_ABSENT_COMMAND, "2026-08-11T11:05:00.000Z");

    const rows = await readEvidenceRows(fixture.store, fixture.taskId);
    expect(rows).toHaveLength(4);
    expect(rows.map(rowGeneration)).toEqual([1, 1, 2, 2]);
  });
});

// ─── REGRESSION · byte-identity (the load-bearing half of AC-DC-8) ──────────

describe("AC-DC-8 · the evidence log is never edited (REGRESSION)", () => {
  it("keeps every stored evidence row byte-identical across the bump, and the hash is edit-sensitive", async () => {
    const fixture = await makeFixture();
    await recordAttestedPass(fixture, MARKER_PRESENT_COMMAND, "2026-08-11T10:00:00.000Z");
    await recordSelfReportedRed(fixture, MARKER_PRESENT_COMMAND, "2026-08-11T10:05:00.000Z");

    const rowsBefore = await readEvidenceRows(fixture.store, fixture.taskId);
    // reason: an EMPTY log hashes identically before and after and would make this
    // assertion vacuous — assert a positive trace of the rows actually under test first.
    expect(rowsBefore).toHaveLength(2);
    const hashBefore = hashRows(rowsBefore);
    expect(hashBefore).toHaveLength(64);

    const after = await rewriteCommand(fixture, MARKER_ABSENT_COMMAND);
    expect(declaredGeneration(after)).toBe(2);

    const rowsAfter = await readEvidenceRows(fixture.store, fixture.taskId);
    expect(rowsAfter).toHaveLength(2);
    expect(hashRows(rowsAfter)).toBe(hashBefore);

    // Sensitivity control: the same hash MUST change for a one-field edit, or the
    // equality above would prove nothing about the rows' contents.
    const tampered = JSON.parse(JSON.stringify(rowsAfter)) as Record<string, unknown>[];
    const firstTampered = tampered[0];
    if (firstTampered === undefined) throw new Error("tampered copy lost its first row");
    firstTampered["result"] = "fail";
    expect(hashRows(tampered)).not.toBe(hashBefore);
  });

  it("leaves deriveAcCoverageState's seven states untouched by the generation facts", async () => {
    const base: AcCoverageFact = {
      ac_id: AC_ID,
      mode: "script",
      pass: 1,
      fail: 0,
      refs: [],
      attested_pass: 0,
      attested_fail: 0,
      falsified: 0,
    };
    expect(deriveAcCoverageState(base)).toBe("pass_unfalsified");

    const withSplit = {
      ...base,
      oracle_generation: { current: 3, current_refs: 0, prior_refs: 1 },
    } as unknown as AcCoverageFact;
    expect(deriveAcCoverageState(withSplit)).toBe("pass_unfalsified");

    const failing = { ...base, fail: 1, falsified: 1 };
    expect(deriveAcCoverageState(failing)).toBe("fail");
    expect(
      deriveAcCoverageState({
        ...failing,
        oracle_generation: { current: 9, current_refs: 0, prior_refs: 1 },
      } as unknown as AcCoverageFact),
    ).toBe("fail");
  });

  it("never stamps a row that carries no ac_ref", async () => {
    const fixture = await makeFixture();
    await rewriteCommand(fixture, MARKER_ABSENT_COMMAND);
    await recordAttestedPass(fixture, "bun run typecheck", "2026-08-11T12:00:00.000Z", null);

    const rows = await readEvidenceRows(fixture.store, fixture.taskId);
    expect(rows).toHaveLength(1);
    // Positive trace that the case under test was actually constructed: no `ac_ref` on
    // the stored row (a default-parameter slip once re-added one, and the assertion
    // below silently measured a STAMPED row instead).
    expect(asRecord(rows[0])["ac_ref"]).toBeUndefined();
    expect(rowGeneration(rows[0])).toBeUndefined();
  });

  it("counts a legacy all-unstamped evidence log exactly as before", async () => {
    const fixture = await makeFixture();
    const task = await readTask(fixture.store, fixture.taskId);
    // A pre-mechanism log: rows carry NO ac_oracle_generation at all.
    const legacyRows = [
      {
        oracle: "test",
        command: MARKER_PRESENT_COMMAND,
        result: "pass",
        recorded_at: "2026-07-01T00:00:00.000Z",
        recorded_by: "alice",
        ac_ref: AC_ID,
      },
      {
        oracle: "test",
        command: MARKER_PRESENT_COMMAND,
        result: "fail",
        recorded_at: "2026-07-02T00:00:00.000Z",
        recorded_by: "alice",
        ac_ref: AC_ID,
      },
    ];
    const written = await fixture.store.update(fixture.taskId, {
      extra: { ...task.extra, verification_evidence: legacyRows },
    });
    expect(written.ok).toBe(true);

    const fact = await coverageFact(fixture);
    expect({ pass: fact.pass, fail: fact.fail, falsified: fact.falsified }).toEqual({
      pass: 1,
      fail: 1,
      falsified: 1,
    });
    // A never-rewritten criterion is at generation 1, so an unstamped row is CURRENT.
    expect(generationSplit(fact)).toEqual({ current: 1, current_refs: 2, prior_refs: 0 });
  });
});

// ─── NEGATIVE ───────────────────────────────────────────────────────────────

describe("AC-DC-8 · what does NOT bump a generation (NEGATIVE)", () => {
  it("does not bump when the identical command is re-set", async () => {
    const fixture = await makeFixture();
    const first = await rewriteCommand(fixture, MARKER_ABSENT_COMMAND);
    expect(declaredGeneration(first)).toBe(2);

    const again = await rewriteCommand(fixture, MARKER_ABSENT_COMMAND);
    expect(declaredGeneration(again)).toBe(2);
  });

  it("does not bump on a statement-only edit, and never invents a generation", async () => {
    const fixture = await makeFixture();
    const edited = await fixture.acService.setCriterion(fixture.specId, AC_ID, {
      statement: "A grep over apps/web for LORE_ORACLE_MARKER exits 0 within 5 seconds",
    });
    expect(edited.ok).toBe(true);

    const criterion = await readCriterion(fixture.acService, fixture.specId);
    expect(declaredGeneration(criterion)).toBeUndefined();
    if (criterion.verify.mode !== "script") throw new Error("mode must stay script");
    expect(criterion.verify.command).toBe(MARKER_PRESENT_COMMAND);

    // A statement-only edit after a real bump keeps the bumped value, unchanged.
    await rewriteCommand(fixture, MARKER_ABSENT_COMMAND);
    const bumpedEdit = await fixture.acService.setCriterion(fixture.specId, AC_ID, {
      statement: "A grep over apps/web for LORE_ORACLE_MARKER exits 1 within 5 seconds",
    });
    expect(bumpedEdit.ok).toBe(true);
    expect(declaredGeneration(await readCriterion(fixture.acService, fixture.specId))).toBe(2);
  });
});

// ─── BOUNDARY ───────────────────────────────────────────────────────────────

describe("AC-DC-8 · generation boundaries (BOUNDARY)", () => {
  it("reads an ABSENT oracle_generation as generation 1, so the first rewrite yields 2", async () => {
    const fixture = await makeFixture();
    expect(declaredGeneration(await readCriterion(fixture.acService, fixture.specId))).toBeUndefined();
    const bumped = await rewriteCommand(fixture, MARKER_ABSENT_COMMAND);
    expect(declaredGeneration(bumped)).toBe(2);
  });

  it("refuses a non-positive or fractional oracle_generation on the criterion schema", () => {
    const criterion = {
      id: AC_ID,
      statement: "A grep over apps/web for LORE_ORACLE_MARKER exits 0",
      verify: { mode: "script", oracle: "test", command: MARKER_PRESENT_COMMAND },
    };
    expect(specAcceptanceCriteriaSchema.safeParse([{ ...criterion, oracle_generation: 1 }]).success).toBe(
      true,
    );
    expect(specAcceptanceCriteriaSchema.safeParse([{ ...criterion, oracle_generation: 0 }]).success).toBe(
      false,
    );
    expect(
      specAcceptanceCriteriaSchema.safeParse([{ ...criterion, oracle_generation: 1.5 }]).success,
    ).toBe(false);
  });

  it("refuses a non-positive or fractional ac_oracle_generation on an evidence row", () => {
    const row = {
      oracle: "test",
      command: MARKER_PRESENT_COMMAND,
      result: "pass",
      recorded_at: "2026-08-11T10:00:00.000Z",
      recorded_by: "alice",
      ac_ref: AC_ID,
    };
    expect(evidenceEntrySchema.safeParse({ ...row, ac_oracle_generation: 1 }).success).toBe(true);
    expect(evidenceEntrySchema.safeParse({ ...row, ac_oracle_generation: 0 }).success).toBe(false);
    expect(evidenceEntrySchema.safeParse({ ...row, ac_oracle_generation: 2.5 }).success).toBe(false);
  });
});

// ─── ERROR ──────────────────────────────────────────────────────────────────

describe("AC-DC-8 · the stamp is never caller-supplied (ERROR)", () => {
  it("refuses a caller-supplied ac_oracle_generation on the self-reported path and writes nothing", async () => {
    const fixture = await makeFixture();
    const smuggled = {
      oracle: "test",
      command: MARKER_PRESENT_COMMAND,
      result: "expected-fail",
      recorded_by: "agent:oracle-generation",
      capture_source: "self-report",
      output_tail: "1 failed",
      ac_ref: AC_ID,
      ac_oracle_generation: 99,
    } as unknown as EvidenceInput;

    const result = await fixture.taskWorkflowService.addEvidence(fixture.taskId, smuggled);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.error.code).toBe("VALIDATION_ERROR");
    expect(JSON.stringify(result.error)).toContain("ac_oracle_generation");
    expect(await readEvidenceRows(fixture.store, fixture.taskId)).toHaveLength(0);
  });

  it("refuses a caller-supplied ac_oracle_generation on the runner-attested path too", async () => {
    const fixture = await makeFixture();
    const smuggled = {
      oracle: "test",
      command: MARKER_PRESENT_COMMAND,
      result: "pass",
      recorded_by: "agent:oracle-generation",
      capture_source: "runner",
      output_tail: "1 passed",
      ac_ref: AC_ID,
      ac_oracle_generation: 99,
      attestation: { runner: "lore-cli", exit_code: 0, duration_ms: 12, timed_out: false },
    } as unknown as VerifiedEvidenceInput;

    const result = await fixture.taskWorkflowService.recordVerifiedEvidence(
      fixture.taskId,
      smuggled,
      "2026-08-11T10:00:00.000Z",
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.error.code).toBe("VALIDATION_ERROR");
    expect(JSON.stringify(result.error)).toContain("ac_oracle_generation");
    expect(await readEvidenceRows(fixture.store, fixture.taskId)).toHaveLength(0);
  });

  it("still refuses an ac_ref that names no declared criterion, so no unstampable row is ever committed", async () => {
    const fixture = await makeFixture();
    const entry = {
      oracle: "test",
      command: MARKER_PRESENT_COMMAND,
      result: "expected-fail",
      recorded_by: "agent:oracle-generation",
      capture_source: "self-report",
      output_tail: "1 failed",
      ac_ref: "AC-NOT-DECLARED",
    } as unknown as EvidenceInput;

    const result = await fixture.taskWorkflowService.addEvidence(fixture.taskId, entry);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.error.code).toBe("VALIDATION_ERROR");
    expect(await readEvidenceRows(fixture.store, fixture.taskId)).toHaveLength(0);
  });
});

// ─── STATE ──────────────────────────────────────────────────────────────────

describe("AC-DC-8 · generations are monotonic and never reused (STATE)", () => {
  it("advances 2 → 3 → 4 across three rewrites while prior_refs accumulates", async () => {
    const fixture = await makeFixture();
    await recordAttestedPass(fixture, MARKER_PRESENT_COMMAND, "2026-08-11T10:00:00.000Z");

    const second = await rewriteCommand(fixture, MARKER_ABSENT_COMMAND);
    expect(declaredGeneration(second)).toBe(2);
    await recordAttestedPass(fixture, MARKER_ABSENT_COMMAND, "2026-08-11T10:30:00.000Z");
    expect(generationSplit(await coverageFact(fixture))).toEqual({
      current: 2,
      current_refs: 1,
      prior_refs: 1,
    });

    const third = await rewriteCommand(fixture, "grep -rqc LORE_ORACLE_MARKER apps/web");
    expect(declaredGeneration(third)).toBe(3);
    await recordAttestedPass(fixture, "grep -rqc LORE_ORACLE_MARKER apps/web", "2026-08-11T11:00:00.000Z");
    expect(generationSplit(await coverageFact(fixture))).toEqual({
      current: 3,
      current_refs: 1,
      prior_refs: 2,
    });

    const fourth = await rewriteCommand(fixture, "rg -q LORE_ORACLE_MARKER apps/web");
    expect(declaredGeneration(fourth)).toBe(4);
    expect(generationSplit(await coverageFact(fixture))).toEqual({
      current: 4,
      current_refs: 0,
      prior_refs: 3,
    });

    const rows = await readEvidenceRows(fixture.store, fixture.taskId);
    expect(rows.map(rowGeneration)).toEqual([1, 2, 3]);
  });
});
