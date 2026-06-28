/**
 * Tests for InMemoryAIProvider (SPEC-017 §3.8).
 *
 * The InMemoryAIProvider ships in src/ (not tests/) and is the test double used
 * by other tests. These tests verify that the double itself behaves correctly —
 * a broken test double would give false confidence in higher-level tests.
 *
 * Spec-first expectations:
 *   - Default mode returns ok with "# Stub doc\n" content (exact string from spec)
 *   - setMode("err") → next call returns err Result (never throws)
 *   - calls array appended on every invocation regardless of mode
 *   - Error mode returns the exact error configured via setMode
 *
 * Adversarial angles:
 *   - Verify DEFAULT content is exactly "# Stub doc\n" not some other stub string
 *   - Verify that err mode returns Result.err, NOT throws (catches swallowed errors)
 *   - Verify calls.length increases correctly across mode changes
 *   - setMode("ok") after "err" reverts to ok path
 *
 * @spec_ref SPEC-017 §3.8
 */

import { describe, it, expect } from "vitest";
import { InMemoryAIProvider } from "../../../src/ai/in-memory-provider.js";

// ─── Default (ok) mode ───────────────────────────────────────────────────────

describe("InMemoryAIProvider — default ok mode", () => {
  it("returns ok result in default mode", async () => {
    const provider = new InMemoryAIProvider();
    const result = await provider.generate({
      prompt: "Generate a PRD",
      doc_type: "prd",
      title: "Test",
    });
    expect(result.ok).toBe(true);
  });

  it("default content is exactly '# Stub doc\\n' (spec §3.8 literal)", async () => {
    const provider = new InMemoryAIProvider();
    const result = await provider.generate({
      prompt: "Generate",
      doc_type: "prd",
      title: "T",
    });
    if (!result.ok) throw new Error("Expected ok result");
    expect(result.value.content).toBe("# Stub doc\n");
  });

  it("result.value.exit_code is 0 in ok mode", async () => {
    const provider = new InMemoryAIProvider();
    const result = await provider.generate({
      prompt: "Generate",
      doc_type: "spec",
      title: "T",
    });
    if (!result.ok) throw new Error("Expected ok result");
    expect(result.value.exit_code).toBe(0);
  });

  it("result.value.provider_name matches the constructor name", async () => {
    const provider = new InMemoryAIProvider("my-provider");
    const result = await provider.generate({
      prompt: "Generate",
      doc_type: "adr",
      title: "T",
    });
    if (!result.ok) throw new Error("Expected ok result");
    expect(result.value.provider_name).toBe("my-provider");
  });

  it("custom content via constructor is returned verbatim", async () => {
    const provider = new InMemoryAIProvider("stub", { kind: "ok", content: "# Custom\n" });
    const result = await provider.generate({
      prompt: "Generate",
      doc_type: "knowledge",
      title: "T",
    });
    if (!result.ok) throw new Error("Expected ok result");
    expect(result.value.content).toBe("# Custom\n");
  });
});

// ─── Error mode ─────────────────────────────────────────────────────────────

describe("InMemoryAIProvider — err mode via setMode", () => {
  it("setMode err → generate returns Result.err (never throws)", async () => {
    const provider = new InMemoryAIProvider();
    provider.setMode({
      kind: "err",
      error: { code: "AI_PROVIDER_ERROR", message: "binary missing", provider: "in-memory" },
    });
    // Must not throw — must return Result.err
    const result = await provider.generate({
      prompt: "Generate",
      doc_type: "prd",
      title: "T",
    });
    expect(result.ok).toBe(false);
  });

  it("err result carries the exact error from setMode", async () => {
    const provider = new InMemoryAIProvider();
    const configuredError = {
      code: "AI_PROVIDER_ERROR" as const,
      message: "Configured test failure",
      provider: "in-memory",
      exit_code: 42,
    };
    provider.setMode({ kind: "err", error: configuredError });
    const result = await provider.generate({
      prompt: "Generate",
      doc_type: "plan",
      title: "T",
    });
    if (result.ok) throw new Error("Expected err result");
    expect(result.error.code).toBe("AI_PROVIDER_ERROR");
    // Narrow to AI_PROVIDER_ERROR to access message (discriminated union)
    if (result.error.code !== "AI_PROVIDER_ERROR") throw new Error("Expected AI_PROVIDER_ERROR");
    expect(result.error.message).toBe("Configured test failure");
  });

  it("setMode ok after err reverts to success path", async () => {
    const provider = new InMemoryAIProvider();
    provider.setMode({ kind: "err", error: { code: "AI_PROVIDER_ERROR", message: "fail" } });
    provider.setMode({ kind: "ok", content: "# Reverted\n" });
    const result = await provider.generate({
      prompt: "Generate",
      doc_type: "prd",
      title: "T",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected ok");
    expect(result.value.content).toBe("# Reverted\n");
  });
});

// ─── calls array (AC-AI-4 service-slice enabler) ────────────────────────────

describe("InMemoryAIProvider — calls tracking", () => {
  it("starts with empty calls array", () => {
    const provider = new InMemoryAIProvider();
    expect(provider.calls).toHaveLength(0);
  });

  it("records each generate() invocation in calls[]", async () => {
    const provider = new InMemoryAIProvider();
    await provider.generate({ prompt: "p1", doc_type: "prd", title: "T1" });
    await provider.generate({ prompt: "p2", doc_type: "spec", title: "T2" });
    expect(provider.calls).toHaveLength(2);
  });

  it("calls[] records inputs in order", async () => {
    const provider = new InMemoryAIProvider();
    await provider.generate({ prompt: "first", doc_type: "prd", title: "A" });
    await provider.generate({ prompt: "second", doc_type: "adr", title: "B" });
    expect(provider.calls[0]?.title).toBe("A");
    expect(provider.calls[1]?.title).toBe("B");
  });

  it("calls[] is appended even in err mode", async () => {
    const provider = new InMemoryAIProvider();
    provider.setMode({ kind: "err", error: { code: "AI_PROVIDER_ERROR", message: "fail" } });
    await provider.generate({ prompt: "p", doc_type: "task", title: "T" });
    expect(provider.calls).toHaveLength(1);
  });

  it("calls[] records the full input including parent_title", async () => {
    const provider = new InMemoryAIProvider();
    await provider.generate({
      prompt: "p",
      doc_type: "spec",
      title: "My Spec",
      parent_title: "Parent PRD",
    });
    expect(provider.calls[0]?.parent_title).toBe("Parent PRD");
  });
});
