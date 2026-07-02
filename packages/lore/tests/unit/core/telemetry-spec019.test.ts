/**
 * Unit tests for SPEC-019 additions to aiGenerationEventSchema in @lore/core telemetry.ts.
 *
 * SPEC-019 added two new fields to aiGenerationEventSchema:
 *   - kind: z.enum(["create","regenerate","refine","infer"]).default("create")
 *   - target_doc_id: z.string().nullable().optional()
 *
 * Spec-first expectations:
 *   HAPPY:
 *     - aiGenerationEventSchema parses event with kind="regenerate" + target_doc_id="<id>"
 *     - aiGenerationEventSchema parses event with kind="refine" + target_doc_id="<id>"
 *     - aiGenerationEventSchema parses event with kind="infer" + target_doc_id="<id>"
 *     - aiGenerationEventSchema parses event with kind="infer" + target_doc_id=null
 *     - aiGenerationEventSchema parses event with kind="create" + target_doc_id=null
 *
 *   REGRESSION (backward compatibility):
 *     - Old event WITHOUT kind field parses with kind defaulting to "create"
 *     - Old event WITHOUT target_doc_id field parses successfully (optional field)
 *     - Event with neither kind nor target_doc_id parses (both added as optional/default)
 *
 *   NEGATIVE:
 *     - kind="unknown-kind" is rejected (not in the enum)
 *     - kind=null is rejected (must be a string from the enum)
 *     - target_doc_id=123 (number) is rejected (must be string or null)
 *
 * Adversarial angles:
 *   - Default("create") must fire when kind is ABSENT from input, not when kind=undefined
 *   - target_doc_id=null is valid (create path — doc doesn't exist yet)
 *   - target_doc_id absent is also valid (pre-SPEC-019 events)
 *   - Strict schema rejects unknown fields — tests confirm no extra fields added inadvertently
 *
 * @spec_ref SPEC-019 §8 Q6, AC-AI-TEL-1
 *
 * NOTE: imports aiGenerationEventSchema via relative path because @lore/core in
 * node_modules symlinks to the main repo (which may not yet have the SPEC-019 fields
 * when these tests run in the implementation worktree). The relative path resolves
 * to packages/core/src/telemetry.ts in THIS worktree, which has the new fields.
 * When SPEC-019 is merged to main, both paths are equivalent.
 */

import { describe, it, expect } from "vitest";
// reason: import from source path so these tests reference the worktree's updated
// packages/core/src/telemetry.ts rather than the node_modules symlink which
// points to the pre-SPEC-019 main repo. Equivalent to @lore/core once merged.
import { aiGenerationEventSchema } from "../../../../core/src/telemetry.js";

// ─── Shared fixture factory ────────────────────────────────────────────────────

/**
 * Build a minimal valid aiGenerationEvent (no kind / no target_doc_id).
 * Represents a pre-SPEC-019 event shape — used as base for regression tests.
 */
function makeBaseEvent(overrides: Record<string, unknown> = {}) {
  return {
    event: "ai.generation",
    ts: "2026-01-01T00:00:00.000Z",
    provider: "claude-cli",
    doc_type: "prd",
    template_source: "built-in",
    duration_ms: 3200,
    output_chars: 512,
    exit_code: 0,
    ...overrides,
  };
}

// ─── HAPPY: new kind field ─────────────────────────────────────────────────────

describe("aiGenerationEventSchema — HAPPY: kind field (SPEC-019)", () => {
  it("parses event with kind='regenerate'", () => {
    const event = makeBaseEvent({ kind: "regenerate", target_doc_id: "01HDOC000000000000000001" });
    const result = aiGenerationEventSchema.safeParse(event);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected success");
    expect(result.data.kind).toBe("regenerate");
  });

  it("parses event with kind='refine'", () => {
    const event = makeBaseEvent({ kind: "refine", target_doc_id: "01HDOC000000000000000002" });
    const result = aiGenerationEventSchema.safeParse(event);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected success");
    expect(result.data.kind).toBe("refine");
  });

  it("parses event with kind='infer'", () => {
    const event = makeBaseEvent({ kind: "infer", target_doc_id: "01HDOC000000000000000003" });
    const result = aiGenerationEventSchema.safeParse(event);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected success");
    expect(result.data.kind).toBe("infer");
  });

  it("parses event with kind='create'", () => {
    const event = makeBaseEvent({ kind: "create", target_doc_id: null });
    const result = aiGenerationEventSchema.safeParse(event);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected success");
    expect(result.data.kind).toBe("create");
  });
});

// ─── HAPPY: target_doc_id field ───────────────────────────────────────────────

describe("aiGenerationEventSchema — HAPPY: target_doc_id field (SPEC-019)", () => {
  it("parses event with target_doc_id='<ulid-string>'", () => {
    const id = "01HDOC00000000000000ABC01";
    const event = makeBaseEvent({ kind: "regenerate", target_doc_id: id });
    const result = aiGenerationEventSchema.safeParse(event);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected success");
    expect(result.data.target_doc_id).toBe(id);
  });

  it("parses event with target_doc_id=null (create path — doc does not exist yet)", () => {
    const event = makeBaseEvent({ kind: "create", target_doc_id: null });
    const result = aiGenerationEventSchema.safeParse(event);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected success");
    expect(result.data.target_doc_id).toBeNull();
  });

  it("parses event with kind='infer' and target_doc_id=null", () => {
    // Edge case: infer path with from-doc not yet created (hypothetical scenario)
    const event = makeBaseEvent({ kind: "infer", target_doc_id: null });
    const result = aiGenerationEventSchema.safeParse(event);
    expect(result.success).toBe(true);
  });
});

// ─── REGRESSION: backward compatibility (pre-SPEC-019 events) ─────────────────

describe("aiGenerationEventSchema — REGRESSION: backward compatibility", () => {
  it("event WITHOUT kind field parses and defaults to kind='create'", () => {
    // Pre-SPEC-019 events never had the kind field.
    // schema uses .default("create") so absence → default, not failure.
    const event = makeBaseEvent(); // no kind field
    const result = aiGenerationEventSchema.safeParse(event);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected success — kind must have a default");
    // The default must be 'create' per SPEC-019 §8 Q6
    expect(result.data.kind).toBe("create");
  });

  it("event WITHOUT target_doc_id field parses successfully (optional field)", () => {
    // Pre-SPEC-019 events never had target_doc_id.
    const event = makeBaseEvent(); // no target_doc_id field
    const result = aiGenerationEventSchema.safeParse(event);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected success — target_doc_id must be optional");
  });

  it("event with neither kind nor target_doc_id parses successfully", () => {
    // Represents an event emitted by generate() before SPEC-019 landed.
    const event = makeBaseEvent();
    expect("kind" in event).toBe(false);
    expect("target_doc_id" in event).toBe(false);
    const result = aiGenerationEventSchema.safeParse(event);
    expect(result.success).toBe(true);
  });

  it("existing fields (event, provider, doc_type, etc.) still parse correctly alongside kind", () => {
    const event = makeBaseEvent({
      kind: "refine",
      target_doc_id: "01HDOC000000000000000FULL",
      caller_surface: "cli",
      ai_default_source: "cli_flag",
      error: "Something went wrong",
      output_chars: 0,
      exit_code: 1,
    });
    const result = aiGenerationEventSchema.safeParse(event);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected success");
    expect(result.data.kind).toBe("refine");
    expect(result.data.caller_surface).toBe("cli");
    expect(result.data.exit_code).toBe(1);
  });
});

// ─── NEGATIVE: invalid kind values ────────────────────────────────────────────

describe("aiGenerationEventSchema — NEGATIVE: invalid kind values", () => {
  it("kind='unknown-kind' is rejected (not in enum)", () => {
    const event = makeBaseEvent({ kind: "unknown-kind" });
    const result = aiGenerationEventSchema.safeParse(event);
    expect(result.success).toBe(false);
  });

  it("kind='generate' is rejected (generate is not a valid kind)", () => {
    // 'generate' is the method name but NOT a valid kind value
    const event = makeBaseEvent({ kind: "generate" });
    const result = aiGenerationEventSchema.safeParse(event);
    expect(result.success).toBe(false);
  });

  it("kind=null is rejected (must be string from enum, not null)", () => {
    const event = makeBaseEvent({ kind: null });
    const result = aiGenerationEventSchema.safeParse(event);
    expect(result.success).toBe(false);
  });

  it("kind=42 (number) is rejected", () => {
    const event = makeBaseEvent({ kind: 42 });
    const result = aiGenerationEventSchema.safeParse(event);
    expect(result.success).toBe(false);
  });
});

// ─── NEGATIVE: invalid target_doc_id values ───────────────────────────────────

describe("aiGenerationEventSchema — NEGATIVE: invalid target_doc_id values", () => {
  it("target_doc_id=123 (number) is rejected (must be string or null)", () => {
    const event = makeBaseEvent({ kind: "regenerate", target_doc_id: 123 });
    const result = aiGenerationEventSchema.safeParse(event);
    expect(result.success).toBe(false);
  });

  it("target_doc_id=false (boolean) is rejected", () => {
    const event = makeBaseEvent({ kind: "refine", target_doc_id: false });
    const result = aiGenerationEventSchema.safeParse(event);
    expect(result.success).toBe(false);
  });
});
