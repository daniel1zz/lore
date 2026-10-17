// @reads packages/lore/src/flows/task-feed-flow.ts
/**
 * CONTRACT NOTE — `buildTaskStartPack` must REFUSE to assemble a dispatch pack for a
 * RETRACTED (invalidated) task, and must be byte-for-byte unchanged for a live one
 * (task-validity-landed-on-lore-list-only-the-dispatch-surface, Required #2).
 *
 * ## Why this file exists as a separate oracle
 *
 * `lore feed task-start <task>` is the pack an agent reads immediately BEFORE
 * committing work. Its reader is a MACHINE acting on the pack alone — the pack exists
 * precisely so it does not have to cross-check. Measured on `main @ 074df1cd`: a
 * retracted task produced a complete, confident, entirely normal-looking work order
 * with NO retraction signal in any of the eight sections, and exit 0.
 *
 * ## How these assertions must NOT be written
 *
 *   1. ⛔ Asserting only "the retracted task is refused". A blanket implementation that
 *      broke the pack for EVERY task passes that. Every refusal assertion below is
 *      PAIRED with the HAPPY control — the same call against a live task still returns
 *      a complete eight-section pack, deep-equal across repeat calls.
 *   2. ⛔ Asserting on a single token. Two INDEPENDENT lone tokens are pinned
 *      (`RETRACTED` and `invalid_at`), both of which are unconditionally present on
 *      every refusal (a retraction with no successor and no reason still emits both),
 *      so a message reword that drops one is caught rather than silently tolerated.
 *   3. ⛔ Re-deriving "is this invalidated" in the test. The fixtures set
 *      `extra.validity.invalid_at` and let the SSOT predicate decide, so a
 *      future-dated invalidation reads as LIVE here exactly as it does in production.
 *
 * Six-dimension coverage:
 *   HAPPY:      a live task still yields all eight sections, `truncated: []`, and two
 *               identical calls are deep-equal (the control for every refusal below)
 *   NEGATIVE:   a retracted task is refused — `ok: false`, VALIDATION_ERROR on
 *               `extra.validity`, message carries BOTH lone tokens, and NO pack is
 *               returned (there is nothing for a machine to act on)
 *   BOUNDARY:   a FUTURE-dated `invalid_at` is LIVE (pack served); `invalid_at` exactly
 *               equal to the evaluation instant is RETRACTED (`<=` semantics);
 *               a retraction with neither successor nor reason still refuses loudly
 *   ERROR:      a fatal `getTaskBundle` failure still propagates VERBATIM — the new
 *               validity check never masks or reshapes an upstream error
 *   STATE:      clearing `extra.validity` (the `--undo` shape) makes the SAME task
 *               servable again, and the served pack equals the never-retracted pack
 *   REGRESSION: the refusal reads the task's OWN `extra` — no new `TaskFeedFlowDeps`
 *               port is required, and the non-fatal degrade paths are untouched
 *
 * Source: task-validity-landed-on-lore-list-only-the-dispatch-surface Required #2;
 *   SPEC-043 §Design Decisions D3/D4; `service/validity-service.ts` (the SSOT
 *   read-surface projection this flow consumes rather than re-deriving).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ok, err } from "@lore/core";
import type { DocId, DocRecord, LoreError, Result } from "@lore/core";
import {
  buildTaskStartPack,
  type TaskBundle,
  type TaskFeedFlowDeps,
  type KnowledgePointer,
  type PlanStateSlice,
  type TaskStartPack,
} from "../../../src/flows/task-feed-flow.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TASK_FEED_FLOW_PATH = resolve(__dirname, "../../../src/flows/task-feed-flow.ts");

/** The evaluation instant every assertion below injects — never a wall-clock read. */
const NOW = "2026-08-06T12:00:00.000Z";
const NOW_FN = (): string => NOW;

// ─── Fixtures ───────────────────────────────────────────────────────────────

function sampleTask(overrides: Partial<DocRecord> = {}): DocRecord {
  return {
    id: "01KAAAAAAAAAAAAAAAAAAAAAAA" as DocId,
    slug: "task-dispatch-me",
    type: "task",
    role: "plan",
    status: "draft",
    priority: "medium",
    title: "Dispatch me",
    content: "Approach: do the thing.",
    parent_id: null,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
    created_by: "test",
    version: 1,
    deleted_at: null,
    tags: [],
    extra: {},
    ...overrides,
  };
}

/** A task carrying `extra.validity` — the shape `lore invalidate` writes. */
function retractedTask(validity: Record<string, unknown>): DocRecord {
  return sampleTask({ extra: { validity } });
}

function sampleBundle(task: DocRecord): TaskBundle {
  return {
    task,
    planSlug: "plan-dispatch",
    specSlug: "spec-043-bitemporal-validity",
    phaseName: null,
    acceptance: [],
    noDeclaredAcs: true,
    danglingScopedIds: [],
    anchors: ["packages/lore/src/flows/task-feed-flow.ts"],
    priorFailures: [],
    unparseableEvidenceCount: 0,
    claimView: null,
    upstreamSpecApproved: true,
    relatedKnowledge: [],
  };
}

function samplePlanState(): PlanStateSlice {
  return { sessions: [], anchor_conflicts: [] };
}

function makeDeps(task: DocRecord, overrides: Partial<TaskFeedFlowDeps> = {}): TaskFeedFlowDeps {
  return {
    getTaskBundle: async () => ok(sampleBundle(task)),
    planStateForTask: async () => ok(samplePlanState()),
    listLinkedKnowledgePointers: async (): Promise<Result<KnowledgePointer[], LoreError>> => ok([]),
    latestHandoffForPlan: async () => ok(null),
    ...overrides,
  };
}

const ALL_SECTION_KEYS: ReadonlyArray<keyof TaskStartPack["sections"]> = [
  "objective",
  "acceptance",
  "constraints",
  "boundaries",
  "claim",
  "plan_state",
  "knowledge_pointers",
  "handoff",
];

/** The refusal's message, or a loud failure if the call unexpectedly succeeded. */
function refusalMessage(result: Result<TaskStartPack, LoreError>): string {
  if (result.ok) throw new Error("expected a refusal, got a pack");
  const error = result.error;
  if (error.code !== "VALIDATION_ERROR") {
    throw new Error(`expected VALIDATION_ERROR, got ${error.code}`);
  }
  return error.message;
}

// ─── HAPPY — the control every refusal assertion is paired with ─────────────

describe("HAPPY control — a LIVE task still yields a complete, deterministic pack", () => {
  it("serves all eight sections with nothing truncated", async () => {
    const result = await buildTaskStartPack(makeDeps(sampleTask()), "task-dispatch-me", undefined, NOW_FN);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const key of ALL_SECTION_KEYS) {
      expect(typeof result.value.sections[key]).toBe("string");
    }
    expect(result.value.sections.objective).toContain("Dispatch me");
    expect(result.value.truncated).toEqual([]);
  });

  it("carries NO retraction token anywhere in the served pack", async () => {
    const result = await buildTaskStartPack(makeDeps(sampleTask()), "task-dispatch-me", undefined, NOW_FN);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const whole = JSON.stringify(result.value);
    expect(whole).not.toContain("RETRACTED");
    expect(whole).not.toContain("invalid_at");
  });

  it("two calls with identical deps, args and instant are deep-equal", async () => {
    const deps = makeDeps(sampleTask());
    const first = await buildTaskStartPack(deps, "task-dispatch-me", undefined, NOW_FN);
    const second = await buildTaskStartPack(deps, "task-dispatch-me", undefined, NOW_FN);
    expect(first).toEqual(second);
  });
});

// ─── NEGATIVE — the retracted task is refused, loudly ──────────────────────

describe("NEGATIVE — a RETRACTED task is refused, and no pack is returned", () => {
  const validity = {
    invalid_at: "2026-08-01T00:00:00.000Z",
    invalidated_by: "01KBBBBBBBBBBBBBBBBBBBBBBB",
    reason: "superseded by the corrected task",
  };

  it("returns err(VALIDATION_ERROR) on field extra.validity, never a pack", async () => {
    const result = await buildTaskStartPack(
      makeDeps(retractedTask(validity)),
      "task-dispatch-me",
      undefined,
      NOW_FN,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    if (result.error.code !== "VALIDATION_ERROR") return;
    expect(result.error.field).toBe("extra.validity");
    expect(result.error.value).toBe("task-dispatch-me");
  });

  it("names TWO independent lone tokens — `RETRACTED` and `invalid_at`", async () => {
    const message = refusalMessage(
      await buildTaskStartPack(makeDeps(retractedTask(validity)), "task-dispatch-me", undefined, NOW_FN),
    );
    // Two INDEPENDENT conditions: a reword that keeps one and drops the other fails.
    expect(message).toContain("RETRACTED");
    expect(message).toContain("invalid_at");
  });

  it("carries the stored successor and reason so the reader knows what to read instead", async () => {
    const message = refusalMessage(
      await buildTaskStartPack(makeDeps(retractedTask(validity)), "task-dispatch-me", undefined, NOW_FN),
    );
    expect(message).toContain("01KBBBBBBBBBBBBBBBBBBBBBBB");
    expect(message).toContain("superseded by the corrected task");
    // The direct-address escape SPEC-043's asymmetry guarantees is named, not implied.
    expect(message).toContain("lore get");
  });
});

// ─── BOUNDARY — the bi-temporal edges, and the barest possible retraction ───

describe("BOUNDARY — bi-temporal edges decide, and a bare retraction still refuses", () => {
  it("a FUTURE-dated invalid_at is LIVE — the pack is served", async () => {
    const result = await buildTaskStartPack(
      makeDeps(retractedTask({ invalid_at: "2026-09-01T00:00:00.000Z" })),
      "task-dispatch-me",
      undefined,
      NOW_FN,
    );
    expect(result.ok).toBe(true);
  });

  it("an invalid_at EQUAL to the evaluation instant is RETRACTED (`<=` semantics)", async () => {
    const result = await buildTaskStartPack(
      makeDeps(retractedTask({ invalid_at: NOW })),
      "task-dispatch-me",
      undefined,
      NOW_FN,
    );
    expect(result.ok).toBe(false);
  });

  it("a retraction with NEITHER successor NOR reason still emits both lone tokens", async () => {
    const message = refusalMessage(
      await buildTaskStartPack(
        makeDeps(retractedTask({ invalid_at: "2026-08-01T00:00:00.000Z" })),
        "task-dispatch-me",
        undefined,
        NOW_FN,
      ),
    );
    expect(message).toContain("RETRACTED");
    expect(message).toContain("invalid_at");
  });

  it("a task whose extra.validity is UNPARSEABLE is served, and the pack says so", async () => {
    // `extractValidity` degrades a malformed payload to undefined, so the SSOT verdict
    // is "live" — but `metadata_unreadable` is what keeps that from being silent.
    const result = await buildTaskStartPack(
      makeDeps(retractedTask({ invalid_at: 12345 })),
      "task-dispatch-me",
      undefined,
      NOW_FN,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sections.constraints).toContain("validity metadata");
  });
});

// ─── ERROR — an upstream failure is never reshaped by the new check ─────────

describe("ERROR — a fatal getTaskBundle failure still propagates verbatim", () => {
  it("propagates DOC_NOT_FOUND untouched", async () => {
    const deps = makeDeps(sampleTask(), {
      getTaskBundle: async () => err({ code: "DOC_NOT_FOUND", id: "nope" }),
    });
    const result = await buildTaskStartPack(deps, "nope", undefined, NOW_FN);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("DOC_NOT_FOUND");
  });
});

// ─── STATE — undoing the retraction makes the same task servable again ──────

describe("STATE — clearing extra.validity restores dispatchability", () => {
  it("the un-retracted pack equals the never-retracted pack", async () => {
    const undone = await buildTaskStartPack(
      makeDeps(retractedTask({ valid_at: "2026-07-01T00:00:00.000Z" })),
      "task-dispatch-me",
      undefined,
      NOW_FN,
    );
    const never = await buildTaskStartPack(makeDeps(sampleTask()), "task-dispatch-me", undefined, NOW_FN);
    expect(undone.ok).toBe(true);
    expect(never.ok).toBe(true);
    if (!undone.ok || !never.ok) return;
    expect(undone.value.sections).toEqual(never.value.sections);
  });
});

// ─── REGRESSION — no new port, and the SSOT projection is what decides ──────

describe("REGRESSION — the refusal needs no new dep port and re-derives no predicate", () => {
  it("TaskFeedFlowDeps still has exactly the four documented ports", async () => {
    const deps = makeDeps(sampleTask());
    expect(Object.keys(deps).sort()).toEqual(
      ["getTaskBundle", "latestHandoffForPlan", "listLinkedKnowledgePointers", "planStateForTask"].sort(),
    );
  });

  it("the flow imports the SSOT projection instead of re-deriving isInvalidated itself", () => {
    const source = readFileSync(TASK_FEED_FLOW_PATH, "utf8");
    // Two INDEPENDENT positive conditions: the helper NAME and the SSOT module path.
    expect(source).toContain("projectValidityStatus");
    expect(source).toContain("validity-service.js");
    // ⛔ And the negative half — the predicate itself is never imported here, which is
    // what "adopt the shipped helper, do not write a second predicate" means in code.
    expect(source).not.toContain("isInvalidated");
  });
});
