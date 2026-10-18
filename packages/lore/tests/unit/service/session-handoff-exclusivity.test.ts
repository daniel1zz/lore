/**
 * Tests for the CorpusService-layer half of the handoff writer-identity guard
 * (SPEC-041 §4 AC-SL-4) — `create()` rejects `type: "knowledge"` +
 * `extra.sub_type: "handoff"`, while the internal `createHandoffDoc` port (the
 * only path `SessionService.writeHandoff` uses) bypasses that one rejection.
 * Uses InMemoryStore — no file I/O, no SQLite.
 *
 * Dimension mapping:
 *   ERROR:      `create()` with a handoff-shaped knowledge doc → VALIDATION_ERROR
 *               whose message contains the literal substring "lore handoff".
 *   HAPPY:      `createHandoffDoc()` succeeds with the identical payload.
 *   REGRESSION: `create()` with a non-handoff knowledge sub_type still succeeds.
 *
 * @spec_ref SPEC-041 §4 AC-SL-4
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import type { CreateDocInput } from "@lore/core";
import { actedStore } from "../../live-invocation.js";

function validHandoffPayload(): Record<string, unknown> {
  return {
    sub_type: "handoff",
    handoff: {
      by: "x",
      task_refs: [],
      modified_files: [],
      key_decisions: [],
      next_steps: ["a"],
    },
  };
}

describe("CorpusService — handoff writer-identity guard (AC-SL-4)", () => {
  it("create() rejects type:knowledge + sub_type:handoff with VALIDATION_ERROR mentioning 'lore handoff'", async () => {
    const store = actedStore(new InMemoryStore());
    const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));

    const result = await corpusService.create({
      type: "knowledge",
      title: "x",
      content: "# x",
      extra: validHandoffPayload(),
    } as CreateDocInput);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    const message = (result.error as { message?: string }).message ?? "";
    expect(message).toContain("lore handoff");
  });

  it("createHandoffDoc() succeeds with the identical payload create() rejected", async () => {
    const store = actedStore(new InMemoryStore());
    const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));

    const result = await corpusService.createHandoffDoc({
      type: "knowledge",
      title: "x",
      content: "# x",
      extra: validHandoffPayload(),
    } as CreateDocInput);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.value.extra as { sub_type?: string }).sub_type).toBe("handoff");
  });

  it("REGRESSION: create() with a non-handoff knowledge sub_type (ideation) still succeeds", async () => {
    const store = actedStore(new InMemoryStore());
    const corpusService = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));

    const result = await corpusService.create({
      type: "knowledge",
      title: "An idea",
      content: "# Idea",
      extra: { sub_type: "ideation" },
    } as CreateDocInput);

    expect(result.ok).toBe(true);
  });
});
