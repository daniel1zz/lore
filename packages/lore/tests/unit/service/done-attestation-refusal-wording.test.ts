/**
 * `lore done`'s attestation-floor refusal WORDING —
 * task-lore-done-s-attestation-refusal-calls-a-capture-source.
 *
 * MEASURED DEFECT (2026-08-03, `main @ f100663`): the refusal told an operator
 * holding SEVEN `capture_source: "runner"` rows that the task "holds only
 * SELF-REPORTED result:pass evidence". Every row's `capture_source` said
 * `"runner"`, so the message named a field value the rows did not have; the
 * reader spent two investigation rounds inspecting `capture_source` and
 * `dist/lore`'s mtime before discovering the predicate reads a DIFFERENT field
 * (`attestation`). A refusal that MISDIRECTS is worse than a silent one: a
 * silence invites investigation, a confident wrong pointer terminates it.
 *
 * ⛔ WORDING-ONLY. The refusal PREDICATE is CORRECT and this suite's job is
 * half to pin the new text and half to PROVE the predicate did not move:
 * `assertRefusalInvariants`/the PREDICATE-INVARIANCE matrix below run the same
 * populations that were refused before this change and assert the same verdict,
 * the same `LoreError.code`, the same `field`, and the same CLI exit code (4,
 * via the real `exitCode` mapping — never a remembered constant).
 *
 * ⛔ Message assertions key on TWO OR MORE INDEPENDENT LONE TOKENS, never one
 * remembered sentence: a contiguous-substring matcher degrades silently to
 * no-match when the prose is reflowed (standing CLAUDE.md lesson), and in THIS
 * corpus it also degrades to a FALSE POSITIVE because docs quote the very
 * markers they document (knowledge-the-substring-matcher-lesson-has-a-mirror-
 * face-over). The `attestation`-is-named assertion is additionally anchored
 * STRUCTURALLY: `--override-attestation` (a remedy flag, present before AND
 * after this change) is stripped from the message first, so the token can only
 * be satisfied by a genuine reference to the missing FIELD.
 *
 * Coverage dimensions:
 *   HAPPY:       a genuine runner-attested pass still archives, unchanged;
 *                the new wording is NEVER emitted for a call that is not refused
 *   NEGATIVE:    an all-`capture_source:"runner"` population is not called
 *                self-reported, and `attestation` is named as the gap (AC-1)
 *   BOUNDARY:    a MIXED population is described accurately about the mix
 *                (AC-3); a legacy row with an ABSENT `capture_source` reads as
 *                self-reported, never as runner-captured
 *   ERROR:       a genuinely self-reported population is STILL described
 *                accurately (AC-2) — the word was not merely deleted
 *   STATE:       the three OTHER independent `done()` floors (red-first,
 *                declared-ac_scope/no-new-tests, unfiltered-test-file-anchor)
 *                still fire independently, and none masks another (AC-5); the
 *                audited `--override-attestation` still archives and still
 *                records its reason verbatim (AC-6)
 *   REGRESSION:  the refused SET, the error code, the error field and the exit
 *                code are byte-identical across every population (AC-4)
 *
 * @spec_ref adr-lore-done-requires-a-runner-attested-pass-the-sixth-false
 * @spec_ref task-lore-done-s-attestation-refusal-calls-a-capture-source
 * @spec_ref adr-lore-s-mechanisms-validate-a-proxy-for-the-property-not-the
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { alwaysAutoOverridePort } from "../../helpers/always-auto-override-port.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import {
  TaskWorkflowService,
  type EvidenceInput,
  type VerifiedEvidenceInput,
} from "../../../src/service/task-workflow-service.js";
import { exitCode } from "../../../src/adapters/cli/utils.js";
import type { CreateDocInput, LoreError } from "@lore/core";
import { actedStore } from "../../live-invocation.js";

import { fakeWorktreeProbe } from "../../helpers/fake-worktree-probe.js";
import { ensureRequirementsDocId } from "../../helpers/parented-create.js";
// ─── Harness ────────────────────────────────────────────────────────────────

function makeServices() {
  const store = actedStore(new InMemoryStore());
  const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const taskWorkflowService = new TaskWorkflowService(store, undefined, { claimTtlMinutes: 120 }, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, fakeWorktreeProbe());
  taskWorkflowService.setOverrideDecisionPort(alwaysAutoOverridePort()); // AU-T7: explicit test port; no port = refused
  return { store, corpusService, taskWorkflowService };
}

async function createPlan(cs: CorpusService): Promise<string> {
  const result = await cs.create({ parent_id: await ensureRequirementsDocId(cs), type: "plan", title: "Wording Plan", content: "body" } as CreateDocInput);
  if (!result.ok) throw new Error(`plan create failed: ${JSON.stringify(result.error)}`);
  return result.value.id;
}

async function createTask(
  cs: CorpusService,
  planId: string,
  title = "Wording Task",
  extraOpts: Record<string, unknown> = {},
): Promise<string> {
  const result = await cs.create({
    type: "task",
    title,
    parent_id: planId,
    content: "body",
    extra: { plan_id: planId, ...extraOpts },
  } as CreateDocInput);
  if (!result.ok) throw new Error(`task create failed: ${JSON.stringify(result.error)}`);
  return result.value.id;
}

/** A SELF-REPORTED `result:"pass"` row — `capture_source: "self-report"`, the shape a
 *  bare `lore evidence --result pass --output-tail …` writes.
 *
 *  reason: SUPERSEDED oracle (task-raise-the-evidence-tail-guard-s-predicate-
 *  to-its-own, D5) — was "tsc"; rejectMissingPassOutputTail's D5 raise now
 *  refuses a self-reported "pass" for "tsc" (or any oracle but "manual")
 *  regardless of tail content, so constructing this fixture via addEvidence
 *  would fail outright. "manual" is the one oracle D5 leaves able to reach a
 *  successful self-reported write, and this fixture's whole point is
 *  genuinely-self-reported (capture_source), never a claim about oracle kind. */
function selfReportedPass(overrides: Partial<EvidenceInput> = {}): EvidenceInput {
  return {
    oracle: "manual",
    command: "bun run typecheck",
    result: "pass",
    recorded_by: "alice",
    output_tail: "hand-typed summary",
    capture_source: "self-report",
    ...overrides,
  };
}

/** A RUNNER-CAPTURED but UNATTESTED `result:"pass"` row — `capture_source: "runner"`
 *  with NO `attestation`. This is the EXACT shape `lore evidence --capture` /
 *  `--output-tail-file` writes, and the exact shape all 11 measured refusals held. */
function runnerCapturedPass(overrides: Partial<EvidenceInput> = {}): EvidenceInput {
  return {
    oracle: "test",
    command: "bunx vitest run packages/lore/tests/unit/service/wording.test.ts",
    result: "pass",
    recorded_by: "agent:done-refusal-wording",
    output_tail: "Test Files  1 passed (1)",
    capture_source: "runner",
    ...overrides,
  };
}

/** The one shape that SATISFIES the floor — runner-issued `attestation`. */
function attestedPass(overrides: Partial<VerifiedEvidenceInput> = {}): VerifiedEvidenceInput {
  return {
    oracle: "tsc",
    command: "bun run typecheck",
    result: "pass",
    recorded_by: "runner",
    capture_source: "runner",
    attestation: { runner: "lore-cli", exit_code: 0, duration_ms: 1, timed_out: false },
    ...overrides,
  };
}

/**
 * Strips every `--override-attestation` occurrence (the REMEDY flag, present in
 * the refusal both before and after this change) so a surviving `attestation`
 * token can only come from a genuine reference to the missing FIELD. This is the
 * "anchor structurally + require a second independent condition" discipline: the
 * lone token alone would be satisfied by the flag name and prove nothing.
 */
function withoutRemedyFlag(message: string): string {
  return message.split("--override-attestation").join("«FLAG»");
}

/**
 * `LoreError` is a discriminated union and only its VALIDATION_ERROR-family
 * members carry `message` — this narrows once, loudly, so no assertion below can
 * silently read `undefined` off the wrong variant and "pass".
 */
function messageOf(error: LoreError): string {
  if (error.code !== "VALIDATION_ERROR") {
    throw new Error(`expected VALIDATION_ERROR, got ${error.code}: ${JSON.stringify(error)}`);
  }
  return error.message;
}

/**
 * The invariants that MUST NOT move (AC-4). Asserted on every refusal in this
 * suite rather than once, so a population-specific wording branch can never
 * quietly change the error identity for only one population.
 */
function assertRefusalInvariants(error: LoreError): void {
  expect(error.code).toBe("VALIDATION_ERROR");
  expect((error as { field?: string }).field).toBe("extra.verification_evidence");
  // The CLI contract the operator actually observes — derived from the real
  // mapping, never a remembered literal.
  expect(exitCode(error)).toBe(4);
}

// ─── HAPPY — an attested pass still archives, and emits NO refusal at all ────

describe("HAPPY — the attestation floor's satisfying shape is untouched", () => {
  it("a task holding a runner-attested pass still archives through the full walk", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    await taskWorkflowService.recordVerifiedEvidence(taskId, attestedPass(), "2026-08-06T09:00:00.000Z");

    const done = await taskWorkflowService.done(taskId, { by: "alice" });
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.value.transitions).toEqual(["approved", "active", "archived"]);
  });

  // NEGATIVE CONTROL ON THE NEW WORDING — a message change that ALWAYS fires
  // passes any one-directional "the text is present" check. A call that is NOT
  // refused must produce NO error object at all, so none of the new tokens can
  // reach the operator.
  it("a call that is NOT refused produces no error object, so the new wording is never emitted", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    // A runner-captured row that WOULD trip the floor on its own, plus a genuine
    // attestation: proves the wording is bound to the REFUSAL, not to the
    // presence of a `capture_source:"runner"` row.
    await taskWorkflowService.addEvidence(taskId, runnerCapturedPass());
    await taskWorkflowService.recordVerifiedEvidence(taskId, attestedPass(), "2026-08-06T09:00:00.000Z");

    const done = await taskWorkflowService.done(taskId, { by: "alice" });
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.value.task.status).toBe("archived");
  });
});

// ─── NEGATIVE (AC-1) — the measured defect: an all-runner-captured population ─

describe("NEGATIVE — AC-1: an all-`capture_source:runner` population is never called self-reported", () => {
  it("names capture_source, calls the rows runner-captured, names attestation as the gap, and contains NO self-report claim", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    // The measured reproduction: every pass row written by `--capture`.
    for (const command of ["bunx vitest run a.test.ts", "bun run typecheck", "bun run build"]) {
      const write = await taskWorkflowService.addEvidence(taskId, runnerCapturedPass({ command }));
      expect(write.ok).toBe(true);
    }

    const done = await taskWorkflowService.done(taskId, { by: "alice" });
    expect(done.ok).toBe(false);
    if (done.ok) return;
    assertRefusalInvariants(done.error);
    const message = messageOf(done.error);

    // ⛔ THE DEFECT — the message must not attribute a value these rows do not
    // carry. Case-insensitive and covering both spellings, because the old text
    // used the SHOUTED form ("SELF-REPORTED") while the field value is lowercase.
    expect(message.toLowerCase()).not.toContain("self-report");

    // Lone token 1 — the field the reader was misdirected to inspect is named,
    // so the two axes can be told apart instead of collapsed into one word.
    expect(message).toContain("capture_source");
    // Lone token 2 — what the rows ACTUALLY are.
    expect(message).toContain("runner-captured");
    // Lone token 3, structurally anchored — the MISSING field, not the flag.
    expect(withoutRemedyFlag(message)).toContain("attestation");
    // The population is stated as a COUNT, not hand-waved: three pass rows.
    expect(message).toContain("3");

    // Both remedies survive (they are the operator's only exits).
    expect(message).toContain("lore verify");
    expect(message).toContain("--override-attestation");

    // The refusal never partially writes.
    const after = await corpusService.get(taskId);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.value.doc.status).toBe("draft");
  });

  it("states WHY a runner-captured row is insufficient — the caller chose the command; attestation proves its provenance", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    await taskWorkflowService.addEvidence(taskId, runnerCapturedPass());

    const done = await taskWorkflowService.done(taskId, { by: "alice" });
    expect(done.ok).toBe(false);
    if (done.ok) return;
    const message = messageOf(done.error);

    // Two independent lone tokens for the WHY clause — the mechanism that makes
    // `--capture` weaker than attestation is named, not merely asserted.
    expect(message).toContain("--capture");
    expect(message).toContain("provenance");
    // and the direction of the implication is stated in terms of the exit code
    // `--capture` does prove.
    expect(message).toContain("exit code");
  });
});

// ─── ERROR (AC-2) — a genuinely self-reported population is still accurate ───

describe("ERROR — AC-2: a genuinely `capture_source:self-report` population keeps its accurate description", () => {
  it("calls the rows self-reported (the word was not merely deleted) and does NOT claim they are runner-captured", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    await taskWorkflowService.addEvidence(taskId, selfReportedPass());
    await taskWorkflowService.addEvidence(taskId, selfReportedPass({ command: "bun run lint" }));

    const done = await taskWorkflowService.done(taskId, { by: "alice" });
    expect(done.ok).toBe(false);
    if (done.ok) return;
    assertRefusalInvariants(done.error);
    const message = messageOf(done.error);

    // Lone token 1 — the population IS named for what it is.
    expect(message.toLowerCase()).toContain("self-report");
    // Lone token 2 — the discriminating field is still named, so the operator
    // can check the claim against the corpus.
    expect(message).toContain("capture_source");
    // Lone token 3, structurally anchored — the missing field.
    expect(withoutRemedyFlag(message)).toContain("attestation");
    // NEGATIVE half of AC-2: it must NOT over-claim the other population.
    expect(message).not.toContain("runner-captured");
    // Count is accurate.
    expect(message).toContain("2");
  });
});

// ─── BOUNDARY (AC-3) — a mixed population is described about the mix ─────────

describe("BOUNDARY — AC-3: a MIXED population is described accurately about the mix", () => {
  it("reports both sub-populations with their own counts, naming runner-captured AND self-reported", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    await taskWorkflowService.addEvidence(taskId, runnerCapturedPass());
    await taskWorkflowService.addEvidence(taskId, runnerCapturedPass({ command: "bun run typecheck" }));
    await taskWorkflowService.addEvidence(taskId, selfReportedPass({ command: "bun run lint" }));

    const done = await taskWorkflowService.done(taskId, { by: "alice" });
    expect(done.ok).toBe(false);
    if (done.ok) return;
    assertRefusalInvariants(done.error);
    const message = messageOf(done.error);

    expect(message).toContain("runner-captured");
    expect(message.toLowerCase()).toContain("self-report");
    // The counts are per-population, not a single lumped total: 3 pass rows =
    // 2 runner-captured + 1 self-reported. Asserted as independent
    // number-adjacent-to-label pairs so a single "3" cannot satisfy them all.
    expect(message).toMatch(/2 runner-captured/);
    expect(message).toMatch(/1 self-reported/);
  });

  // A pre-`capture_source` row (the field was optional at the write boundary
  // before task-capture-source-is-optional-at-the-evidence-write-boundary) must
  // read as SELF-REPORTED, never be silently counted as runner-captured — the
  // same no-silent-fallback rule the append path already encodes.
  it("a legacy row with an ABSENT capture_source is counted as self-reported, never as runner-captured", async () => {
    const { corpusService, store, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    // Written directly to the store — `EvidenceInput` now REQUIRES
    // `capture_source`, so the legacy shape is unreachable through addEvidence
    // and can only be constructed as stored state.
    const current = await corpusService.get(taskId);
    expect(current.ok).toBe(true);
    if (!current.ok) return;
    const legacyRow = {
      oracle: "tsc",
      command: "bun run typecheck",
      result: "pass",
      recorded_at: "2026-07-01T00:00:00.000Z",
      recorded_by: "alice",
      output_tail: "hand-typed summary",
    };
    const written = await store.update(
      taskId,
      { extra: { ...current.value.doc.extra, verification_evidence: [legacyRow] } },
      { expected_version: current.value.doc.version },
    );
    expect(written.ok).toBe(true);

    const done = await taskWorkflowService.done(taskId, { by: "alice" });
    expect(done.ok).toBe(false);
    if (done.ok) return;
    assertRefusalInvariants(done.error);
    const message = messageOf(done.error);
    expect(message.toLowerCase()).toContain("self-report");
    expect(message).not.toContain("runner-captured");
  });
});

// ─── REGRESSION (AC-4) — PREDICATE INVARIANCE: the refused SET never moved ───

describe("REGRESSION — AC-4: the refused set, error identity and exit code are unchanged", () => {
  // Every population that was REFUSED before this change is still refused,
  // with the same code/field/exit code. The table is the predicate's contract:
  // if a row ever flips to `ok`, the wording change relaxed the floor.
  const REFUSED_POPULATIONS: ReadonlyArray<{
    readonly name: string;
    readonly rows: readonly EvidenceInput[];
  }> = [
    { name: "zero evidence rows at all", rows: [] },
    { name: "one self-reported pass", rows: [selfReportedPass()] },
    { name: "one runner-captured pass", rows: [runnerCapturedPass()] },
    { name: "mixed unattested passes", rows: [runnerCapturedPass(), selfReportedPass()] },
    {
      name: "runner-captured non-pass rows only",
      rows: [
        runnerCapturedPass({ result: "fail", output_tail: "AssertionError: expected 1 to be 2" }),
        runnerCapturedPass({ result: "expected-fail", output_tail: "AssertionError: expected 1 to be 2" }),
      ],
    },
  ];

  it.each(REFUSED_POPULATIONS)("$name is still refused, VALIDATION_ERROR on extra.verification_evidence, exit 4", async ({ rows }) => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    for (const row of rows) {
      const write = await taskWorkflowService.addEvidence(taskId, row);
      expect(write.ok).toBe(true);
    }

    const done = await taskWorkflowService.done(taskId, { by: "alice" });
    expect(done.ok).toBe(false);
    if (done.ok) return;
    assertRefusalInvariants(done.error);
    // `value` still carries the per-row diagnostic pair the caller could always
    // read programmatically — the wording change never replaced structure with prose.
    expect(Array.isArray((done.error as { value?: unknown }).value)).toBe(true);
  });

  it("a blank overrideReason is STILL refused on the `overrideReason` field, not on the evidence field", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    await taskWorkflowService.addEvidence(taskId, runnerCapturedPass());

    const done = await taskWorkflowService.done(taskId, { by: "alice", overrideReason: "   " });
    expect(done.ok).toBe(false);
    if (done.ok) return;
    expect(done.error.code).toBe("VALIDATION_ERROR");
    expect((done.error as { field?: string }).field).toBe("overrideReason");
    expect(exitCode(done.error)).toBe(4);
  });

  it("an already-archived task is STILL an idempotent no-op, evaluated before this floor", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    await taskWorkflowService.addEvidence(taskId, runnerCapturedPass());
    const first = await taskWorkflowService.done(taskId, { by: "alice", overrideReason: "manual browser check" });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = await taskWorkflowService.done(taskId, { by: "alice" });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.already_done).toBe(true);
    expect(second.value.transitions).toEqual([]);
  });
});

// ─── STATE (AC-5, AC-6) — the other floors and the audited escape ───────────

// ⛔ All four `done()` evidence floors report the SAME `field`
// (`extra.verification_evidence`), so the field alone cannot tell them apart —
// each floor is identified below by its OWN message tokens, plus a NEGATIVE
// condition asserting the attestation floor's new wording is absent. That pair
// is what proves the floors stayed independent instead of one absorbing another.
describe("STATE — AC-5: the three OTHER independent done() floors still fire, and none masks another", () => {
  it("the red-first floor fires with its OWN message once the attestation floor is satisfied", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId, "Red First Task", { red_first: true });

    // Attestation floor satisfied; the red-first floor must now be the blocker.
    await taskWorkflowService.recordVerifiedEvidence(taskId, attestedPass(), "2026-08-06T09:00:00.000Z");

    const done = await taskWorkflowService.done(taskId, { by: "alice" });
    expect(done.ok).toBe(false);
    if (done.ok) return;
    expect(done.error.code).toBe("VALIDATION_ERROR");
    expect(messageOf(done.error)).toContain("extra.red_first");
    expect(messageOf(done.error)).toContain("expected-fail");
    // The attestation floor's own wording must NOT appear — it already passed.
    expect(messageOf(done.error)).not.toContain("runner-captured");
    expect(messageOf(done.error)).not.toContain("capture_source");
  });

  it("the declared-ac_scope no-new-tests floor fires with its OWN message once the attestation floor is satisfied", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    // An EXPLICITLY EMPTY declaration arms the floor (keyed on PRESENCE).
    const taskId = await createTask(corpusService, planId, "Declared Scope Task", { ac_scope: [] });

    await taskWorkflowService.recordVerifiedEvidence(taskId, attestedPass(), "2026-08-06T09:00:00.000Z");

    const done = await taskWorkflowService.done(taskId, { by: "alice" });
    expect(done.ok).toBe(false);
    if (done.ok) return;
    expect(done.error.code).toBe("VALIDATION_ERROR");
    expect(messageOf(done.error)).toContain("EMPTY extra.ac_scope");
    expect(messageOf(done.error)).toContain("--declare-no-new-tests");
    expect(messageOf(done.error)).not.toContain("runner-captured");
    expect(messageOf(done.error)).not.toContain("capture_source");
  });

  it("the unfiltered-test-file-anchor floor fires with its OWN message once the attestation floor is satisfied", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const ANCHOR = "packages/lore/tests/unit/service/done-attestation-refusal-wording.test.ts";
    const taskId = await createTask(corpusService, planId, "Anchored Task", {
      file_anchors: [ANCHOR],
      red_first: true,
    });

    // Satisfies the attestation floor AND the red-first floor, leaving the
    // test-file-anchor floor as the only remaining blocker.
    await taskWorkflowService.recordVerifiedEvidence(taskId, attestedPass(), "2026-08-06T09:00:00.000Z");
    await taskWorkflowService.addEvidence(
      taskId,
      runnerCapturedPass({ result: "fail", output_tail: "AssertionError: expected 1 to be 2" }),
    );

    const done = await taskWorkflowService.done(taskId, { by: "alice" });
    expect(done.ok).toBe(false);
    if (done.ok) return;
    expect(done.error.code).toBe("VALIDATION_ERROR");
    expect(messageOf(done.error)).toContain(ANCHOR);
    expect(messageOf(done.error)).toContain("UNFILTERED");
    expect(messageOf(done.error)).not.toContain("runner-captured");
  });

  it("the attestation floor is checked FIRST — a red-first task with NO attested pass reports the ATTESTATION field, not the red one", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId, "Both Floors Task", { red_first: true });

    await taskWorkflowService.addEvidence(taskId, runnerCapturedPass());

    const done = await taskWorkflowService.done(taskId, { by: "alice" });
    expect(done.ok).toBe(false);
    if (done.ok) return;
    assertRefusalInvariants(done.error);
    // The ATTESTATION floor's wording, not the red-first floor's — ordering is
    // load-bearing (a task can be in violation of both; the operator must be
    // told about the one checked first, exactly as before this change).
    expect(messageOf(done.error)).toContain("runner-captured");
    expect(messageOf(done.error)).not.toContain("extra.red_first");
  });
});

describe("STATE — AC-6: the audited --override-attestation escape still archives and still records its reason", () => {
  it("archives an unattested runner-captured task and stamps the reason verbatim on every audit step", async () => {
    const { corpusService, store, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    await taskWorkflowService.addEvidence(taskId, runnerCapturedPass());

    const REASON = "manual browser check: verified in staging, screenshot attached to PR #123";
    const done = await taskWorkflowService.done(taskId, { by: "alice", overrideReason: REASON });
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.value.transitions).toEqual(["approved", "active", "archived"]);

    const audit = await store.queryAudit({ doc_id: taskId });
    expect(audit.ok).toBe(true);
    if (!audit.ok) return;
    const doneSteps = audit.value.filter((e) => e.details?.["done"] === true);
    expect(doneSteps).toHaveLength(3);
    expect(doneSteps.every((e) => e.details?.["override_reason"] === REASON)).toBe(true);
    expect(doneSteps.every((e) => e.details?.["attestation_overridden"] === true)).toBe(true);
  });
});

// ─── The zero-pass sibling arm keeps its own accurate description ────────────

describe("BOUNDARY — the sibling arm (no result:pass row at all) names attestation and both remedies", () => {
  it("a task holding only non-pass rows is told it holds no pass row, and is pointed at the same two remedies", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    await taskWorkflowService.addEvidence(
      taskId,
      runnerCapturedPass({ result: "fail", output_tail: "AssertionError: expected 1 to be 2" }),
    );

    const done = await taskWorkflowService.done(taskId, { by: "alice" });
    expect(done.ok).toBe(false);
    if (done.ok) return;
    assertRefusalInvariants(done.error);
    const message = messageOf(done.error);

    // Two independent lone tokens: the shape it lacks, and the field it lacks.
    expect(message).toContain('result:"pass"');
    expect(withoutRemedyFlag(message)).toContain("attestation");
    // ⛔ It must NOT call these rows self-reported either — they are runner-captured.
    expect(message.toLowerCase()).not.toContain("self-report");
    expect(message).toContain("lore verify");
    expect(message).toContain("--override-attestation");
  });
});

// ─── The remedy half: `lore verify <plan>` is not universally runnable ───────
//
// Defect B, measured 2026-08-06 in the SAME message: it prescribes "run `lore
// verify <plan>`" unconditionally, but an `--adhoc` task has no plan, and
// `lore verify --task <adhoc>` refuses (exit 4) when `ac_scope` is an EMPTY
// array. The message therefore sent the class of task that MOST OFTEN hits this
// refusal down a route that cannot succeed. ⛔ The STRUCTURAL gap is a separate
// task (task-an-ad-hoc-task-can-never-reach-the-attestation-path-that) and is
// deliberately NOT fixed here — only the message's own claim about
// reachability, which is wording, is in scope.

describe("BOUNDARY — the remedy names the ad-hoc limitation rather than prescribing an unreachable route", () => {
  it("names the --adhoc/`lore verify --task` route and its non-empty ac_scope precondition", async () => {
    const { corpusService, taskWorkflowService } = makeServices();
    const planId = await createPlan(corpusService);
    const taskId = await createTask(corpusService, planId);

    await taskWorkflowService.addEvidence(taskId, runnerCapturedPass());

    const done = await taskWorkflowService.done(taskId, { by: "alice" });
    expect(done.ok).toBe(false);
    if (done.ok) return;
    const message = messageOf(done.error);

    // Three independent lone tokens: the task class, the alternate verb form,
    // and the precondition that decides whether that verb can run at all.
    expect(message).toContain("--adhoc");
    expect(message).toContain("--task");
    expect(message).toContain("ac_scope");
  });
});
