/**
 * Round-trip tests for the two `lore handoff` authoring paths (SPEC-041 §3 D6):
 *   1. `--json-file <path>` (PRIMARY) — the CLI's `parseHandoffJsonFile` pure fn.
 *   2. Repeatable flags (`--file`/`--decision`/`--next`/`--failing-command`/
 *      `--failing-tail-file`/`--plan`/`--by`) — the CLI's `assembleHandoffInput`
 *      pure fn.
 *
 * Both pure functions are imported directly from `adapters/cli/handoff-input.ts`
 * (no subprocess spawn — this module imports only `@lore/core`, never `loader.ts`/
 * `bun:sqlite`; `commands/handoff.ts` imports the SAME functions from there, so
 * this test exercises the exact code the CLI runs, not a re-implementation) and
 * exercised against a real `SessionService` + `InMemoryStore`, proving:
 *   (a) a `--json-file` payload with ALL fields, written via `writeHandoff`, is
 *       reproduced VERBATIM by `SessionService.resume` (AC-SL-7 round-trip half).
 *   (b) the flags path and the json-file path produce structurally IDENTICAL
 *       `extra.handoff` for equivalent input (AC-SL-7 equivalence half).
 *
 * Coverage:
 *   HAPPY:      json-file path with every optional field populated round-trips
 *               losslessly through write → resume
 *   STATE:      flags path and json-file path, given equivalent input, produce
 *               identical extra.handoff (both fresh docs, compared field-by-field)
 *   BOUNDARY:   json-file path with ONLY the required fields (defaults applied by
 *               handoffExtraSchema — task_refs/modified_files/key_decisions: [])
 *   ERROR:      parseHandoffJsonFile on malformed JSON / a handoffExtraSchema
 *               violation (missing next_steps) → {ok: false, error} with a
 *               field-precise message, never throws
 *   NEGATIVE:   assembleHandoffInput with zero flags → a shape handoffExtraSchema
 *               itself rejects (empty next_steps) — proves no silent default fill
 *   REGRESSION: --plan/--by overrides on parseHandoffJsonFile replace only the
 *               targeted fields, leaving the rest of the json-file payload untouched
 *
 * @spec_ref SPEC-041 §4 AC-SL-7
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { SessionService } from "../../../src/service/session-service.js";
import {
  assembleHandoffInput,
  parseHandoffJsonFile,
  parseDecisionFlag,
} from "../../../src/adapters/cli/handoff-input.js";
import type { CreateDocInput, HandoffExtra } from "@lore/core";

function makeServices() {
  const store = new InMemoryStore();
  const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const sessionService = new SessionService(store, {
    claimTtlMinutes: 120,
    handoffTtlMinutes: 10_080,
    createHandoffDoc: corpusService.createHandoffDoc.bind(corpusService),
  });
  return { store, corpusService, sessionService };
}

async function mustCreatePlan(cs: CorpusService, title: string) {
  const result = await cs.create({ type: "plan", title, content: "# Plan" } as CreateDocInput);
  if (!result.ok) throw new Error(`plan create failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

// ─── HAPPY: json-file path, all fields, round-trips through resume ──────────

describe("session-roundtrip — HAPPY: json-file path with all fields", () => {
  it("write via parseHandoffJsonFile → resume reproduces every field verbatim", async () => {
    const { corpusService, sessionService } = makeServices();
    const plan = await mustCreatePlan(corpusService, "Plan Roundtrip");

    const rawJson = JSON.stringify({
      by: "claude",
      plan_ref: plan.slug,
      task_refs: ["task-t1-core-schemas", "task-t2-adapters"],
      modified_files: ["packages/core/src/session.ts", "packages/lore/src/app.ts"],
      key_decisions: [
        { judgment: "extra is SSOT, content is a projection", confidence: 95 },
        { judgment: "no score given for this one" },
      ],
      failing_oracle: { command: "bun run typecheck", output_tail: "error TS2345: ..." },
      next_steps: ["wire SessionService into app.ts", "write MCP tools"],
      degraded: false,
    });

    const parsed = parseHandoffJsonFile(rawJson);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const writeResult = await sessionService.writeHandoff(parsed.value);
    expect(writeResult.ok).toBe(true);
    if (!writeResult.ok) return;

    const resumeResult = await sessionService.resume({ plan: plan.slug });
    expect(resumeResult.ok).toBe(true);
    if (!resumeResult.ok) return;

    expect(resumeResult.value.found).toBe(true);
    expect(resumeResult.value.multi_actor).toBe(false);
    const record = resumeResult.value.handoff;
    expect(record).toBeDefined();
    if (record === undefined) return;

    // Every field from the JSON is reproduced verbatim via the deterministic
    // renderHandoffContent projection.
    expect(record.by).toBe("claude");
    expect(record.plan_slug).toBe(plan.slug);
    expect(record.content).toContain("task-t1-core-schemas");
    expect(record.content).toContain("task-t2-adapters");
    expect(record.content).toContain("packages/core/src/session.ts");
    expect(record.content).toContain("packages/lore/src/app.ts");
    expect(record.content).toContain("extra is SSOT, content is a projection");
    expect(record.content).toContain("95");
    expect(record.content).toContain("no score given for this one");
    expect(record.content).toContain("bun run typecheck");
    expect(record.content).toContain("error TS2345: ...");
    expect(record.content).toContain("wire SessionService into app.ts");
    expect(record.content).toContain("write MCP tools");
    expect(record.degraded).toBe(false);
  });
});

// ─── STATE: flags path and json-file path produce identical docs ────────────

describe("session-roundtrip — STATE: flags path and json-file path equivalence", () => {
  it("equivalent input via assembleHandoffInput and parseHandoffJsonFile produce structurally identical extra.handoff", async () => {
    const { corpusService, sessionService } = makeServices();
    const planA = await mustCreatePlan(corpusService, "Plan Equivalence A");
    const planB = await mustCreatePlan(corpusService, "Plan Equivalence B");

    const flagsInput = assembleHandoffInput({
      by: "claude",
      plan: planA.slug,
      files: ["a.ts", "b.ts"],
      decisions: ["Chose X over Y@85", "No score given"],
      next: ["step one", "step two"],
      failingCommand: "bun test",
      failingTail: "1 test failed",
    });

    const jsonFileInput = parseHandoffJsonFile(
      JSON.stringify({
        by: "claude",
        plan_ref: planB.slug,
        task_refs: [],
        modified_files: ["a.ts", "b.ts"],
        key_decisions: [
          { judgment: "Chose X over Y", confidence: 85 },
          { judgment: "No score given" },
        ],
        failing_oracle: { command: "bun test", output_tail: "1 test failed" },
        next_steps: ["step one", "step two"],
      }),
    );
    expect(jsonFileInput.ok).toBe(true);
    if (!jsonFileInput.ok) return;

    // Both candidates match on everything EXCEPT plan_ref (deliberately pointed at
    // different plans so both writes succeed independently) — normalize that field
    // out before comparing.
    const { plan_ref: _flagsPlanRef, ...flagsRest } = flagsInput;
    const { plan_ref: _jsonPlanRef, ...jsonRest } = jsonFileInput.value;
    expect(flagsRest).toEqual(jsonRest);

    const flagsWrite = await sessionService.writeHandoff(flagsInput);
    const jsonWrite = await sessionService.writeHandoff(jsonFileInput.value);
    expect(flagsWrite.ok).toBe(true);
    expect(jsonWrite.ok).toBe(true);
    if (!flagsWrite.ok || !jsonWrite.ok) return;

    // Same deterministic content EXCEPT the "## Plan" line (different plan_ref).
    const stripPlanLine = (content: string): string =>
      content.replace(/## Plan\n\n[^\n]+\n/, "## Plan\n\n(stripped)\n");
    expect(stripPlanLine(flagsWrite.value.content)).toBe(stripPlanLine(jsonWrite.value.content));
    expect(flagsWrite.value.extra["sub_type"]).toBe("handoff");
    expect(jsonWrite.value.extra["sub_type"]).toBe("handoff");
  });
});

// ─── BOUNDARY: json-file path with only required fields ─────────────────────

describe("session-roundtrip — BOUNDARY: json-file path, required fields only", () => {
  it("omitted optional arrays default to [] per handoffExtraSchema, not silently dropped", () => {
    const parsed = parseHandoffJsonFile(
      JSON.stringify({ by: "claude", next_steps: ["only step"] }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.task_refs).toEqual([]);
    expect(parsed.value.modified_files).toEqual([]);
    expect(parsed.value.key_decisions).toEqual([]);
    expect(parsed.value.failing_oracle).toBeUndefined();
    expect(parsed.value.next_steps).toEqual(["only step"]);
  });
});

// ─── ERROR: parseHandoffJsonFile never throws ────────────────────────────────

describe("session-roundtrip — ERROR: parseHandoffJsonFile", () => {
  it("malformed JSON → {ok: false, error} naming 'invalid JSON', never throws", () => {
    const result = parseHandoffJsonFile("{not valid json");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("invalid JSON");
  });

  it("valid JSON but missing next_steps → {ok: false, error} naming the field, never throws", () => {
    const result = parseHandoffJsonFile(JSON.stringify({ by: "claude" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("next_steps");
  });
});

// ─── NEGATIVE: assembleHandoffInput does not silently satisfy validation ─────

describe("session-roundtrip — NEGATIVE: assembleHandoffInput with zero flags", () => {
  it("produces next_steps: [] — a shape handoffExtraSchema itself rejects (no default fill of a required field)", () => {
    const assembled = assembleHandoffInput({
      by: "claude",
      files: [],
      decisions: [],
      next: [],
    });
    expect(assembled.next_steps).toEqual([]);
  });
});

// ─── REGRESSION: --plan/--by overrides only replace targeted fields ─────────

describe("session-roundtrip — REGRESSION: parseHandoffJsonFile overrides", () => {
  it("a --by override replaces only `by`, leaving plan_ref/next_steps/etc. from the JSON untouched", () => {
    const raw = JSON.stringify({
      by: "original-actor",
      plan_ref: "some-plan",
      next_steps: ["untouched step"],
    });
    const result = parseHandoffJsonFile(raw, { by: "override-actor" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.by).toBe("override-actor");
    expect(result.value.plan_ref).toBe("some-plan");
    expect(result.value.next_steps).toEqual(["untouched step"]);
  });

  it("a --plan override replaces only `plan_ref`, leaving `by`/next_steps untouched", () => {
    const raw = JSON.stringify({
      by: "actor",
      plan_ref: "original-plan",
      next_steps: ["untouched step"],
    });
    const result = parseHandoffJsonFile(raw, { plan: "override-plan" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.by).toBe("actor");
    expect(result.value.plan_ref).toBe("override-plan");
  });
});

// ─── parseDecisionFlag unit coverage (pure helper) ───────────────────────────

describe("parseDecisionFlag", () => {
  it("splits a trailing @NN into confidence", () => {
    expect(parseDecisionFlag("Chose X over Y@90")).toEqual({ judgment: "Chose X over Y", confidence: 90 });
  });

  it("leaves judgment untouched when there is no trailing @NN", () => {
    expect(parseDecisionFlag("No score given")).toEqual({ judgment: "No score given" });
  });

  it("boundary: a bare '@50' with empty judgment falls back to the raw string", () => {
    expect(parseDecisionFlag("@50")).toEqual({ judgment: "@50" });
  });

  it("does not match a non-numeric suffix like an email-shaped judgment", () => {
    expect(parseDecisionFlag("contact user@example.com")).toEqual({ judgment: "contact user@example.com" });
  });
});

// ─── Type-level smoke (HandoffExtra import used for readability) ────────────

describe("session-roundtrip — type sanity", () => {
  it("assembleHandoffInput's return type satisfies HandoffExtra's required shape", () => {
    const value: HandoffExtra = assembleHandoffInput({
      by: "claude",
      files: [],
      decisions: [],
      next: ["a"],
    });
    expect(value.by).toBe("claude");
  });
});
