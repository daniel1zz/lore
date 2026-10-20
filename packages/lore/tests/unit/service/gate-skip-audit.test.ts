/**
 * Unit tests for SPEC-080 G4 (gate-skip observability, AC-080-1) — `GateEnforcer`'s
 * config-disabled skip now fires a best-effort, fire-and-forget `gate_skipped` audit
 * write through its OPTIONAL `recordGateSkip` port (`gate-enforcer.ts`). Pure decision
 * logic + injected fakes only — no store, no `bun:sqlite` — hence vitest.
 *
 * Six-dimension coverage: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION.
 *
 * @spec_ref SPEC-080 §Scope, §Design Decisions D1/D2; AC-080-1
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  GateEnforcer,
  buildGateSkipAuditEntry,
  describeThrown,
  describeLoreError,
  type RecordGateSkip,
} from "../../../src/service/gate-enforcer.js";
import type { AuditEntry, LoreConfig, LoreError, Result } from "@lore/core";
import { ok, err } from "@lore/core";
import { liveWarn } from "../../live-invocation.js";

/** Flushes pending microtasks (promise `.then`/`.catch` chains) without advancing macrotasks. */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

/** Spies on `process.stderr.write` (swallowing real output), restored via `vi.restoreAllMocks()`. */
function spyStderr() {
  return vi.spyOn(process.stderr, "write").mockImplementation(() => true);
}

const DISABLED_SPEC_PROMOTE_CONFIG = {
  project: { name: "x", author: "y" },
  workflow: {
    claim_ttl_minutes: 120,
    gates: { "spec-promote": { enabled: false } },
  },
} as unknown as LoreConfig;

describe("GateEnforcer — SPEC-080 G4 gate-skip audit (recordGateSkip port)", () => {
  const originalLoreActor = process.env["LORE_ACTOR"];
  const originalSessionId = process.env["CLAUDE_CODE_SESSION_ID"];

  beforeEach(() => {
    process.env["CLAUDE_CODE_SESSION_ID"] = "9a7e5c1b-1111-2222-3333-444444444444";
    // decoy: must be ignored (BR-1055)
    process.env["LORE_ACTOR"] = "decoy-lore-actor-must-be-ignored";
  });

  afterEach(() => {
    if (originalLoreActor === undefined) {
      delete process.env["LORE_ACTOR"];
    } else {
      process.env["LORE_ACTOR"] = originalLoreActor;
    }
    if (originalSessionId === undefined) {
      delete process.env["CLAUDE_CODE_SESSION_ID"];
    } else {
      process.env["CLAUDE_CODE_SESSION_ID"] = originalSessionId;
    }
    vi.restoreAllMocks();
  });

  // HAPPY — a wired, succeeding port receives exactly ONE gate_skipped entry with the
  // correct checkpoint/actor/target/mechanism, and enforce() still returns ok(undefined).
  it("writes exactly ONE gate_skipped audit entry with correct checkpoint/actor/target/mechanism", async () => {
    const stderrSpy = spyStderr();
    const recordGateSkip = vi.fn<RecordGateSkip>().mockResolvedValue(ok(undefined));
    // the gate row's actor is the wired port's name (the invocation's known party); the process env (a session id, a
    // LORE_ACTOR decoy) names nobody, and a port-less enforcer cannot name an actor at all
    const enforcer = new GateEnforcer(DISABLED_SPEC_PROMOTE_CONFIG, recordGateSkip, undefined, () => "agent:session-9a7e5c1b", process.env, liveWarn());

    const result = enforcer.enforce("spec-promote", {
      acceptanceCriteriaCount: 0,
      // reason: AC-FR-8/D7 (task-derive-lore-feed-s-checkpoint-set-from-the-
      // registry-make) — `specIdOrSlug` (display-only, usually a slug) is
      // DELIBERATELY a DIFFERENT string from `targetDocId` (the REAL id) here,
      // so an assertion keyed on the real id could not accidentally pass by
      // reading the wrong field. `recordSkip` must read `targetDocId` only.
      specIdOrSlug: "spec-x-slug",
      targetDocId: "01SPECXREALID",
    });

    expect(result).toEqual({ ok: true, value: undefined });
    // reason: recordGateSkip is called SYNCHRONOUSLY inside enforce() (fire-and-forget
    // — only its settlement is deferred), so it must already be invoked here.
    expect(recordGateSkip).toHaveBeenCalledTimes(1);

    const entry = recordGateSkip.mock.calls[0]![0];
    expect(entry.action).toBe("gate_skipped");
    expect(entry.actor).toBe("agent:session-9a7e5c1b");
    expect(entry.doc_id).toBe("01SPECXREALID");
    expect(entry.details).toEqual({
      checkpoint: "spec-promote",
      mechanism: "config_disabled",
      target: "01SPECXREALID",
    });
    expect(typeof entry.timestamp).toBe("string");
    expect(entry.session_id).toBe("gate-skip");

    await flushMicrotasks();
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  // HAPPY — task-claim's target resolves from ctx.targetDocId — NEVER from the
  // display-only ctx.targetIdOrSlug, even when the latter is present too
  // (AC-FR-8/D7: the two must never be conflated, see GateContext.targetDocId's
  // own JSDoc, checkpoint-registry.ts).
  it("resolves target from ctx.targetDocId, never the display-only ctx.targetIdOrSlug (task-claim shape)", () => {
    const config = {
      project: { name: "x", author: "y" },
      workflow: { claim_ttl_minutes: 120, gates: { "task-claim": { enabled: false } } },
    } as unknown as LoreConfig;
    const recordGateSkip = vi.fn<RecordGateSkip>().mockResolvedValue(ok(undefined));
    const enforcer = new GateEnforcer(config, recordGateSkip, undefined, () => "test-actor", {}, liveWarn());

    enforcer.enforce("task-claim", {
      hasSpecParent: false,
      targetIdOrSlug: "task-y-slug",
      targetDocId: "01TASKYREALID",
    });

    expect(recordGateSkip).toHaveBeenCalledTimes(1);
    const entry = recordGateSkip.mock.calls[0]![0];
    expect(entry.doc_id).toBe("01TASKYREALID");
    expect(entry.details).toMatchObject({ checkpoint: "task-claim", target: "01TASKYREALID" });
  });

  // BOUNDARY — no target available at all (spec-create gates a not-yet-created
  // candidate): doc_id/details.target are OMITTED, never a placeholder.
  it("omits doc_id and details.target when the ctx carries no id/slug (spec-create shape)", () => {
    const config = {
      project: { name: "x", author: "y" },
      workflow: { claim_ttl_minutes: 120, gates: { "spec-create": { enabled: false } } },
    } as unknown as LoreConfig;
    const recordGateSkip = vi.fn<RecordGateSkip>().mockResolvedValue(ok(undefined));
    const enforcer = new GateEnforcer(config, recordGateSkip, undefined, () => "test-actor", {}, liveWarn());

    enforcer.enforce("spec-create", { parentType: "prd", content: "" });

    expect(recordGateSkip).toHaveBeenCalledTimes(1);
    const entry = recordGateSkip.mock.calls[0]![0];
    expect(entry.doc_id).toBeUndefined();
    expect(entry.details).toEqual({ checkpoint: "spec-create", mechanism: "config_disabled" });
    expect("target" in (entry.details as object)).toBe(false);
  });

  // NEGATIVE / REGRESSION — an UNWIRED port (every pre-SPEC-080 bare construction):
  // zero writes, zero stderr, byte-identical ok(undefined) return.
  it("unwired recordGateSkip (bare construction): zero writes, zero stderr, unchanged return value", async () => {
    const stderrSpy = spyStderr();
    const enforcer = new GateEnforcer(DISABLED_SPEC_PROMOTE_CONFIG);

    const result = enforcer.enforce("spec-promote", {
      acceptanceCriteriaCount: 0,
      specIdOrSlug: "spec-x",
    });

    expect(result).toEqual({ ok: true, value: undefined });
    await flushMicrotasks();
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  // ERROR — a port that RESOLVES Result.err: the skip still succeeds (enforce()
  // already returned ok(undefined) before the rejection is even observed), and a
  // stderr warning is eventually printed naming the failure.
  it("a port resolving Result.err: skip still succeeds, one stderr warning is printed", async () => {
    const stderrSpy = spyStderr();
    const failure: LoreError = { code: "STORE_ERROR", message: "disk full" };
    const recordGateSkip = vi.fn<RecordGateSkip>().mockResolvedValue(err(failure) as Result<void, LoreError>);
    const enforcer = new GateEnforcer(DISABLED_SPEC_PROMOTE_CONFIG, recordGateSkip, undefined, () => "test-actor", {}, liveWarn());

    const result = enforcer.enforce("spec-promote", {
      acceptanceCriteriaCount: 0,
      specIdOrSlug: "spec-x",
    });
    expect(result).toEqual({ ok: true, value: undefined });

    await flushMicrotasks();
    expect(stderrSpy).toHaveBeenCalledTimes(1);
    const written = stderrSpy.mock.calls[0]![0] as string;
    expect(written).toContain("spec-promote");
    expect(written).toContain("disk full");
  });

  // ERROR — a port that REJECTS (throws asynchronously): skip still succeeds, one
  // stderr warning is eventually printed.
  it("a rejecting port: skip still succeeds, one stderr warning is printed", async () => {
    const stderrSpy = spyStderr();
    const recordGateSkip = vi.fn<RecordGateSkip>().mockRejectedValue(new Error("network down"));
    const enforcer = new GateEnforcer(DISABLED_SPEC_PROMOTE_CONFIG, recordGateSkip, undefined, () => "test-actor", {}, liveWarn());

    const result = enforcer.enforce("spec-promote", {
      acceptanceCriteriaCount: 0,
      specIdOrSlug: "spec-x",
    });
    expect(result).toEqual({ ok: true, value: undefined });

    await flushMicrotasks();
    expect(stderrSpy).toHaveBeenCalledTimes(1);
    const written = stderrSpy.mock.calls[0]![0] as string;
    expect(written).toContain("network down");
  });

  // ERROR — a port that THROWS SYNCHRONOUSLY (misbehaving port, never even returns a
  // promise): caught by recordSkip's own try/catch, warning printed BEFORE enforce()
  // returns (no microtask flush needed), skip still succeeds.
  it("a synchronously-throwing port: skip still succeeds, warning printed synchronously", () => {
    const stderrSpy = spyStderr();
    const recordGateSkip: RecordGateSkip = vi.fn(() => {
      throw new Error("boom");
    }) as unknown as RecordGateSkip;
    const enforcer = new GateEnforcer(DISABLED_SPEC_PROMOTE_CONFIG, recordGateSkip, undefined, () => "test-actor", {}, liveWarn());

    const result = enforcer.enforce("spec-promote", {
      acceptanceCriteriaCount: 0,
      specIdOrSlug: "spec-x",
    });

    expect(result).toEqual({ ok: true, value: undefined });
    expect(stderrSpy).toHaveBeenCalledTimes(1);
    expect(stderrSpy.mock.calls[0]![0] as string).toContain("boom");
  });

  // STATE — an ENABLED checkpoint that passes normally calls recordGateSkip
  // exactly once, but with a `gate_passed` entry, NEVER `gate_skipped` — the
  // pre-AC-FR-8 version of this test asserted zero calls; the whole point of
  // AC-FR-8 (task-derive-lore-feed-s-checkpoint-set-from-the-registry-make)
  // is that a genuinely passing evaluation is no longer silent.
  it("calls recordGateSkip with a gate_passed (never gate_skipped) entry when the checkpoint is enabled and passes", () => {
    const recordGateSkip = vi.fn<RecordGateSkip>().mockResolvedValue(ok(undefined));
    const enforcer = new GateEnforcer(undefined, recordGateSkip, undefined, () => "test-actor", {}, liveWarn());

    const result = enforcer.enforce("plan-promote", { hasSpecParent: false });

    expect(result).toEqual({ ok: true, value: undefined });
    expect(recordGateSkip).toHaveBeenCalledTimes(1);
    const entry = recordGateSkip.mock.calls[0]![0];
    expect(entry.action).toBe("gate_passed");
    expect(entry.details).toEqual({ checkpoint: "plan-promote", verdict: "pass" });
  });

  // STATE — an ENABLED checkpoint that BLOCKS also never calls recordGateSkip (a
  // predicate failure is not a "skip" — the checkpoint ran, it just failed).
  it("does not call recordGateSkip when the checkpoint is enabled and blocks", () => {
    const recordGateSkip = vi.fn<RecordGateSkip>().mockResolvedValue(ok(undefined));
    const enforcer = new GateEnforcer(undefined, recordGateSkip, undefined, () => "test-actor", {}, liveWarn());

    const result = enforcer.enforce("spec-create", { parentType: "task", content: "" });

    expect(result.ok).toBe(false);
    expect(recordGateSkip).not.toHaveBeenCalled();
  });
});

describe("buildGateSkipAuditEntry (pure builder)", () => {
  // HAPPY
  it("builds an entry with doc_id/details.target present when target is supplied", () => {
    const entry: AuditEntry = buildGateSkipAuditEntry(
      "task-claim",
      "env_bypass",
      "2026-07-26T00:00:00.000Z",
      "alice",
      "task-x",
    );
    expect(entry).toEqual({
      timestamp: "2026-07-26T00:00:00.000Z",
      actor: "alice",
      session_id: "gate-skip",
      action: "gate_skipped",
      doc_id: "task-x",
      details: { checkpoint: "task-claim", mechanism: "env_bypass", target: "task-x" },
    });
  });

  // BOUNDARY — target omitted entirely (never a placeholder value).
  it("omits doc_id and details.target when target is undefined", () => {
    const entry: AuditEntry = buildGateSkipAuditEntry(
      "spec-create",
      "config_disabled",
      "2026-07-26T00:00:00.000Z",
      "bob",
    );
    expect(entry.doc_id).toBeUndefined();
    expect(entry.details).toEqual({ checkpoint: "spec-create", mechanism: "config_disabled" });
  });
});

describe("describeThrown / describeLoreError (pure formatters)", () => {
  // HAPPY
  it("describeThrown extracts an Error's message", () => {
    expect(describeThrown(new Error("oops"))).toBe("oops");
  });

  // NEGATIVE — a non-Error thrown value stringifies instead of throwing itself.
  it("describeThrown stringifies a non-Error thrown value", () => {
    expect(describeThrown("just a string")).toBe("just a string");
    expect(describeThrown(42)).toBe("42");
  });

  // HAPPY
  it("describeLoreError prefers .message when present", () => {
    expect(describeLoreError({ code: "STORE_ERROR", message: "disk full" })).toBe("disk full");
  });

  // BOUNDARY — a LoreError variant with no .message field falls back to .code.
  it("describeLoreError falls back to .code when no message field exists", () => {
    expect(describeLoreError({ code: "DOC_NOT_FOUND", id: "abc", suggestions: [] })).toBe(
      "DOC_NOT_FOUND",
    );
  });
});
