/**
 * Tests for canonicaliseBody write-path integration in CorpusService.
 *
 * Spec: SPEC-021 §4 — corpus must always store a normalised body:
 *   - trailing whitespace collapsed to exactly one LF
 *   - CRLF (\r\n) converted to LF (\n)
 *
 * These tests verify the FIX applied to _createImpl and set:
 *   both now call canonicaliseBody(content) before forwarding to the store.
 *
 * @spec_ref AC-CORPUS-CANONICALISE-001
 */

import { RecordLockService } from "../../../src/service/record-lock-service.js";
import { GateEnforcer } from "../../../src/service/gate-enforcer.js";
import { describe, it, expect } from "vitest";
import { InMemoryStore } from "../../../src/store/in-memory-store.js";
import { CorpusService } from "../../../src/service/corpus-service.js";
import { canonicaliseBody } from "@lore/core";
import { actedStore } from "../../live-invocation.js";

function makeService() {
  const store = actedStore(new InMemoryStore());
  const service = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
  return { service, store };
}

describe("CorpusService.create — canonicalises content on write", () => {
  it("AC-CORPUS-CANONICALISE-001.01: multiple trailing newlines are collapsed to exactly one on create", async () => {
    const { service } = makeService();

    // Create a PRD parent (spec requires parent_id)
    const prdResult = await service.create({ type: "prd", title: "Root PRD" });
    expect(prdResult.ok).toBe(true);
    if (!prdResult.ok) throw new Error("prd create failed: " + prdResult.error.code);

    const rawContent = "foo\n\n\n";
    const specResult = await service.create({
      type: "spec",
      title: "Child Spec",
      content: rawContent,
    });

    expect(specResult.ok).toBe(true);
    if (!specResult.ok) throw new Error("spec create failed: " + specResult.error.code);

    const expected = canonicaliseBody(rawContent); // "foo\n"
    expect(specResult.value.content).toBe(expected);

    // Explicit assertion: must be exactly one trailing newline, not multiple
    expect(specResult.value.content).toBe("foo\n");
  });

  it("AC-CORPUS-CANONICALISE-001.02: different input contents produce different stored values (defeat hardcoded return)", async () => {
    const { service } = makeService();

    const prdResult = await service.create({ type: "prd", title: "Another PRD" });
    expect(prdResult.ok).toBe(true);
    if (!prdResult.ok) throw new Error("prd create failed: " + prdResult.error.code);

    const specAResult = await service.create({
      type: "spec",
      title: "Spec A",
      content: "alpha\n\n",
    });
    expect(specAResult.ok).toBe(true);
    if (!specAResult.ok) throw new Error("spec A create failed: " + specAResult.error.code);

    const specBResult = await service.create({
      type: "spec",
      title: "Spec B",
      content: "beta\n\n\n",
    });
    expect(specBResult.ok).toBe(true);
    if (!specBResult.ok) throw new Error("spec B create failed: " + specBResult.error.code);

    expect(specAResult.value.content).toBe("alpha\n");
    expect(specBResult.value.content).toBe("beta\n");

    // Verify they differ — the implementation cannot have returned the same hardcoded value
    expect(specAResult.value.content).not.toBe(specBResult.value.content);
  });
});

describe("CorpusService.set — canonicalises content on update", () => {
  it("AC-CORPUS-CANONICALISE-001.03: CRLF and double trailing newline are normalised on set", async () => {
    const { service } = makeService();

    // Create PRD parent
    const prdResult = await service.create({ type: "prd", title: "Root PRD" });
    expect(prdResult.ok).toBe(true);
    if (!prdResult.ok) throw new Error("prd create failed: " + prdResult.error.code);

    // Create spec with clean initial content
    const specResult = await service.create({
      type: "spec",
      title: "My Spec",
      content: "original\n",
    });
    expect(specResult.ok).toBe(true);
    if (!specResult.ok) throw new Error("spec create failed: " + specResult.error.code);

    const rawPatch = "updated\r\n\r\n";
    const setResult = await service.set(specResult.value.slug, { content: rawPatch });

    expect(setResult.ok).toBe(true);
    if (!setResult.ok) throw new Error("set failed: " + setResult.error.code);

    const expected = canonicaliseBody(rawPatch); // "updated\n"
    expect(setResult.value.content).toBe(expected);

    // Explicit assertions: CRLF gone, single trailing LF
    expect(setResult.value.content).not.toContain("\r");
    expect(setResult.value.content).toBe("updated\n");
  });

  it("AC-CORPUS-CANONICALISE-001.04: different update contents produce different stored values (defeat hardcoded return)", async () => {
    const { service } = makeService();

    const prdResult = await service.create({ type: "prd", title: "Root PRD 2" });
    expect(prdResult.ok).toBe(true);
    if (!prdResult.ok) throw new Error("prd create failed: " + prdResult.error.code);

    const specResult = await service.create({
      type: "spec",
      title: "Spec for dual-set test",
      content: "initial\n",
    });
    expect(specResult.ok).toBe(true);
    if (!specResult.ok) throw new Error("spec create failed: " + specResult.error.code);

    // First update
    const set1 = await service.set(specResult.value.slug, { content: "first update\r\n\r\n" });
    expect(set1.ok).toBe(true);
    if (!set1.ok) throw new Error("set1 failed: " + set1.error.code);
    expect(set1.value.content).toBe("first update\n");

    // Second update with different content
    const set2 = await service.set(specResult.value.slug, { content: "second update\r\n\r\n\r\n" });
    expect(set2.ok).toBe(true);
    if (!set2.ok) throw new Error("set2 failed: " + set2.error.code);
    expect(set2.value.content).toBe("second update\n");

    // They differ — the implementation is not returning a hardcoded value
    expect(set1.value.content).not.toBe(set2.value.content);
  });
});
