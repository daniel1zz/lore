/**
 * Tests for SessionService.writeHandoff (SPEC-041 S2 lossless handoff write path).
 * Uses InMemoryStore — no file I/O, no SQLite.
 *
 * Dimension mapping:
 *   HAPPY:      valid payload → knowledge/handoff draft doc; content is a
 *               deterministic renderHandoffContent(extra.handoff) projection.
 *   STATE:      four-way parent resolution — plan_ref given / exactly one PRD /
 *               zero PRDs / >1 PRDs.
 *   ERROR:      plan_ref resolving to a nonexistent slug, a soft-deleted plan, or a
 *               non-plan doc — all VALIDATION_ERROR (AC-SL-12).
 *   BOUNDARY:   next_steps empty array rejected; a >300-char key_decision judgment
 *               rejected; a degraded handoff carries the DEGRADED_HANDOFF_MARKER.
 *   REGRESSION: pre-existing knowledge sub_types (ideation, retro, assessment, ...)
 *               still validate fine via the direct corpusService.create path.
 *
 * @spec_ref SPEC-041 §4 AC-SL-3 AC-SL-12
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { SessionService } from "../../../src/service/session-service.js";
import { renderHandoffContent, DEGRADED_HANDOFF_MARKER, canonicaliseBody } from "@lore/core";
import type { CreateDocInput } from "@lore/core";
import { actedStore } from "../../live-invocation.js";

import { ensureRequirementsDocId } from "../../helpers/parented-create.js";
function makeServices() {
  const store = actedStore(new InMemoryStore());
  const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  const sessionService = new SessionService(store, {
    claimTtlMinutes: 120,
    handoffTtlMinutes: 10080,
    createHandoffDoc: corpusService.createHandoffDoc.bind(corpusService),
  });
  return { store, corpusService, sessionService };
}

async function mustCreate(cs: CorpusService, input: CreateDocInput) {
  const result = await cs.create(input);
  if (!result.ok) throw new Error(`create failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

describe("SessionService.writeHandoff — HAPPY (AC-SL-3)", () => {
  it("creates a draft knowledge/handoff doc parented to the given plan, content = renderHandoffContent projection", async () => {
    const { corpusService, sessionService } = makeServices();
    const plan = await mustCreate(corpusService, { parent_id: await ensureRequirementsDocId(corpusService), type: "plan", title: "Plan A", content: "# Plan" } as CreateDocInput);
    const task = await mustCreate(corpusService, {
      type: "task",
      title: "Task A",
      parent_id: plan.id,
      content: "# Task",
      extra: { plan_id: plan.id },
    } as CreateDocInput);

    const result = await sessionService.writeHandoff({
      by: "claude",
      plan_ref: plan.slug,
      task_refs: [task.slug],
      modified_files: ["packages/core/src/session.ts"],
      key_decisions: [{ judgment: "extra is SSOT", confidence: 90 }],
      next_steps: ["wire into app.ts"],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const doc = result.value;

    expect(doc.type).toBe("knowledge");
    expect(doc.status).toBe("draft");
    expect(doc.parent_id).toBe(plan.id);
    expect((doc.extra as { sub_type?: string }).sub_type).toBe("handoff");

    const handoff = (doc.extra as { handoff?: unknown }).handoff as Record<string, unknown>;
    expect(handoff["by"]).toBe("claude");
    expect(handoff["task_refs"]).toEqual([task.slug]);
    expect(handoff["modified_files"]).toEqual(["packages/core/src/session.ts"]);
    expect(handoff["key_decisions"]).toEqual([{ judgment: "extra is SSOT", confidence: 90 }]);
    expect(handoff["next_steps"]).toEqual(["wire into app.ts"]);

    // reason: CorpusService._createImpl canonicalises content at write time
    // (CRLF→LF, trim, exactly one trailing newline — SPEC-021 §4 whitespace parity,
    // applied to EVERY doc, not handoff-specific) — so doc.content is the
    // canonicalised projection, not the raw renderHandoffContent output.
    expect(doc.content).toBe(
      canonicaliseBody(renderHandoffContent(handoff as Parameters<typeof renderHandoffContent>[0])),
    );
  });

  it("defaults task_refs/modified_files/key_decisions to [] rather than leaving them undefined", async () => {
    const { corpusService, sessionService } = makeServices();
    const plan = await mustCreate(corpusService, { parent_id: await ensureRequirementsDocId(corpusService), type: "plan", title: "Plan B", content: "# Plan" } as CreateDocInput);

    const result = await sessionService.writeHandoff({
      by: "claude",
      plan_ref: plan.slug,
      next_steps: ["done"],
    } as Parameters<typeof sessionService.writeHandoff>[0]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const handoff = (result.value.extra as { handoff: Record<string, unknown> }).handoff;
    expect(handoff["task_refs"]).toEqual([]);
    expect(handoff["modified_files"]).toEqual([]);
    expect(handoff["key_decisions"]).toEqual([]);
  });
});

describe("SessionService.writeHandoff — STATE: four-way parent resolution", () => {
  it("(b) no plan_ref, exactly one PRD → parent_id is that PRD's id", async () => {
    const { corpusService, sessionService } = makeServices();
    const prd = await mustCreate(corpusService, { type: "prd", title: "Only PRD", content: "# PRD" } as CreateDocInput);

    const result = await sessionService.writeHandoff({
      by: "claude",
      task_refs: [],
      modified_files: [],
      key_decisions: [],
      next_steps: ["continue"],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.parent_id).toBe(prd.id);
  });

  it("(c) no plan_ref, zero PRDs → refused (VALIDATION_ERROR) naming --plan and the requirements document; nothing written", async () => {
    const { corpusService, sessionService } = makeServices();

    const result = await sessionService.writeHandoff({
      by: "claude",
      task_refs: [],
      modified_files: [],
      key_decisions: [],
      next_steps: ["continue"],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    const text = JSON.stringify(result.error);
    expect(text).toContain("--plan");
    expect(text).toContain("requirements document");
    const listed = await corpusService.list({ type: "knowledge" });
    expect(listed.ok && listed.value.docs.length).toBe(0);
  });

  it("(d) no plan_ref, >1 PRDs → err(VALIDATION_ERROR) requiring plan_ref", async () => {
    const { corpusService, sessionService } = makeServices();
    await mustCreate(corpusService, { type: "prd", title: "PRD One", content: "# 1" } as CreateDocInput);
    await mustCreate(corpusService, { type: "prd", title: "PRD Two", content: "# 2" } as CreateDocInput);

    const result = await sessionService.writeHandoff({
      by: "claude",
      task_refs: [],
      modified_files: [],
      key_decisions: [],
      next_steps: ["continue"],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    expect((result.error as { message?: string }).message).toContain("plan_ref");
  });
});

describe("SessionService.writeHandoff — ERROR (AC-SL-12)", () => {
  it("plan_ref pointing at a nonexistent slug → VALIDATION_ERROR", async () => {
    const { sessionService } = makeServices();
    const result = await sessionService.writeHandoff({
      by: "claude",
      plan_ref: "plan-does-not-exist",
      task_refs: [],
      modified_files: [],
      key_decisions: [],
      next_steps: ["continue"],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("plan_ref pointing at a soft-deleted plan → VALIDATION_ERROR", async () => {
    const { store, corpusService, sessionService } = makeServices();
    const plan = await mustCreate(corpusService, { parent_id: await ensureRequirementsDocId(corpusService), type: "plan", title: "Doomed Plan", content: "# Plan" } as CreateDocInput);
    const deleted = await store.softDelete(plan.id);
    if (!deleted.ok) throw new Error(JSON.stringify(deleted.error));

    const result = await sessionService.writeHandoff({
      by: "claude",
      plan_ref: plan.slug,
      task_refs: [],
      modified_files: [],
      key_decisions: [],
      next_steps: ["continue"],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("plan_ref pointing at a non-plan doc (a task) → VALIDATION_ERROR", async () => {
    const { corpusService, sessionService } = makeServices();
    const plan = await mustCreate(corpusService, { parent_id: await ensureRequirementsDocId(corpusService), type: "plan", title: "Parent Plan", content: "# Plan" } as CreateDocInput);
    const task = await mustCreate(corpusService, {
      type: "task",
      title: "Some Task",
      parent_id: plan.id,
      content: "# Task",
      extra: { plan_id: plan.id },
    } as CreateDocInput);

    const result = await sessionService.writeHandoff({
      by: "claude",
      plan_ref: task.slug,
      task_refs: [],
      modified_files: [],
      key_decisions: [],
      next_steps: ["continue"],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("SessionService.writeHandoff — degraded handoff (AC-SL-12)", () => {
  it("degraded: true renders the exact DEGRADED_HANDOFF_MARKER string, imported not hardcoded", async () => {
    const { corpusService, sessionService } = makeServices();
    await ensureRequirementsDocId(corpusService);
    const result = await sessionService.writeHandoff({
      by: "stop-hook",
      task_refs: [],
      modified_files: ["a.ts"],
      key_decisions: [],
      next_steps: ["review"],
      degraded: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.content.includes(DEGRADED_HANDOFF_MARKER)).toBe(true);
  });
});

describe("SessionService.writeHandoff — BOUNDARY: Zod validation", () => {
  it("next_steps: [] (empty array) → VALIDATION_ERROR (schema requires min 1)", async () => {
    const { sessionService } = makeServices();
    const result = await sessionService.writeHandoff({
      by: "claude",
      task_refs: [],
      modified_files: [],
      key_decisions: [],
      next_steps: [],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("a key_decisions[].judgment over 300 chars → VALIDATION_ERROR", async () => {
    const { sessionService } = makeServices();
    const result = await sessionService.writeHandoff({
      by: "claude",
      task_refs: [],
      modified_files: [],
      key_decisions: [{ judgment: "x".repeat(301) }],
      next_steps: ["review"],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("SessionService.writeHandoff — REGRESSION: pre-existing knowledge sub_types unaffected", () => {
  it("ideation, retro, and assessment sub_types still validate via corpusService.create directly", async () => {
    const { corpusService } = makeServices();

    const ideation = await corpusService.create({
      parent_id: await ensureRequirementsDocId(corpusService), type: "knowledge",
      title: "An idea",
      content: "# Idea",
      extra: { sub_type: "ideation" },
    } as CreateDocInput);
    expect(ideation.ok).toBe(true);

    const retro = await corpusService.create({
      parent_id: await ensureRequirementsDocId(corpusService), type: "knowledge",
      title: "A retro",
      content: "# Retro",
      extra: { sub_type: "retro" },
    } as CreateDocInput);
    expect(retro.ok).toBe(true);

    const reference = await corpusService.create({
      parent_id: await ensureRequirementsDocId(corpusService), type: "knowledge",
      title: "A reference",
      content: "# Reference",
      extra: { sub_type: "reference" },
    } as CreateDocInput);
    expect(reference.ok).toBe(true);
  });
});
