/**
 * Tests for `writePromptToStdin` (`packages/lore/src/ai/claude-cli-provider.ts`,
 * BUG-013 fix) — the sole stdin-write site `ClaudeCliProvider.generate` delegates
 * to. Pre-fix, a synchronous EPIPE (the spawned process crashed / closed its stdin
 * before the write finished) propagated straight past `generate()`, contradicting
 * the module's own "Never throws — all errors are wrapped in
 * err({ code: 'AI_PROVIDER_ERROR', ... })" contract.
 *
 * `writePromptToStdin` takes a structural `StdinSink` (`write`/`end`), not a real
 * `Bun.FileSink` — so this suite is plain-TS/vitest testable with hand-built fakes,
 * no live `Bun.spawn` subprocess required (mirrors `hermetic-spawn.test.ts`'s
 * pure-function testing precedent for this same module family).
 *
 * Six-dimension coverage:
 *   HAPPY:      write() then end() both succeed → ok(undefined); the exact prompt
 *               string is passed through to write() unchanged
 *   NEGATIVE:   an empty-string prompt is still written (not short-circuited) —
 *               this function has no "nothing to write" special case
 *   BOUNDARY:   write() succeeds but end() throws (the two calls are independently
 *               guarded by the SAME try/catch, so a failure on either one is caught);
 *               a very long prompt (10k chars) passes through unchanged
 *   ERROR:      write() throws synchronously (the EPIPE case BUG-013 fixes) → caught,
 *               never propagates, returns err(AI_PROVIDER_ERROR) naming the provider
 *               and the underlying message; a thrown non-Error value (a bare string)
 *               is still stringified into the message, never crashes the formatter
 *   STATE:      the sink's call sequence is always write() THEN end() (never end()
 *               without a prior write(), never end() called twice) on the success
 *               path; on a write() failure, end() is NEVER called (no double-fault)
 *   REGRESSION: the provider name is echoed verbatim into a failure's `provider`
 *               field (diagnosability — a caller juggling multiple registered
 *               providers must be able to tell which one failed)
 *
 * Source: SPEC-017 §3.7; BUG-013 (stdin-write-failure containment).
 */

import { describe, expect, it } from "vitest";
import { writePromptToStdin, type StdinSink } from "../../../src/ai/claude-cli-provider.js";

/** Records every call made to it, in order — `["write:<data>", "end"]`. */
class RecordingSink implements StdinSink {
  readonly calls: string[] = [];
  private readonly writeImpl: (data: string) => number;
  private readonly endImpl: () => void;

  constructor(opts: { writeImpl?: (data: string) => number; endImpl?: () => void } = {}) {
    this.writeImpl = opts.writeImpl ?? (() => 0);
    this.endImpl = opts.endImpl ?? (() => undefined);
  }

  write(data: string): number {
    this.calls.push(`write:${data}`);
    return this.writeImpl(data);
  }

  end(): void {
    this.calls.push("end");
    this.endImpl();
  }
}

// ─── HAPPY ──────────────────────────────────────────────────────────────────

describe("writePromptToStdin — successful write+end (HAPPY)", () => {
  it("returns ok(undefined) and calls write() then end() with the exact prompt", () => {
    const sink = new RecordingSink();

    const result = writePromptToStdin(sink, "generate a PRD about widgets", "claude-cli");

    expect(result.ok).toBe(true);
    expect(sink.calls).toEqual(["write:generate a PRD about widgets", "end"]);
  });
});

// ─── NEGATIVE ───────────────────────────────────────────────────────────────

describe("writePromptToStdin — empty prompt (NEGATIVE)", () => {
  it("still writes an empty string (no short-circuit) and returns ok", () => {
    const sink = new RecordingSink();

    const result = writePromptToStdin(sink, "", "claude-cli");

    expect(result.ok).toBe(true);
    expect(sink.calls).toEqual(["write:", "end"]);
  });
});

// ─── BOUNDARY ───────────────────────────────────────────────────────────────

describe("writePromptToStdin — end() throws after a successful write() (BOUNDARY)", () => {
  it("catches an end()-time failure just like a write()-time one — err(AI_PROVIDER_ERROR)", () => {
    const sink = new RecordingSink({
      endImpl: () => {
        throw new Error("EPIPE: stdin closed before end()");
      },
    });

    const result = writePromptToStdin(sink, "prompt text", "claude-cli");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error.code).toBe("AI_PROVIDER_ERROR");
    expect(sink.calls).toEqual(["write:prompt text", "end"]);
  });
});

describe("writePromptToStdin — very long prompt (BOUNDARY)", () => {
  it("passes a 10,000-character prompt through to write() byte-identical", () => {
    const longPrompt = "x".repeat(10_000);
    const sink = new RecordingSink();

    const result = writePromptToStdin(sink, longPrompt, "claude-cli");

    expect(result.ok).toBe(true);
    expect(sink.calls[0]).toBe(`write:${longPrompt}`);
  });
});

// ─── ERROR ──────────────────────────────────────────────────────────────────

describe("writePromptToStdin — write() throws synchronously (ERROR, the BUG-013 case)", () => {
  it("never propagates the throw — returns err(AI_PROVIDER_ERROR) naming the provider + underlying message", () => {
    const sink = new RecordingSink({
      writeImpl: () => {
        throw new Error("EPIPE: process already exited");
      },
    });

    expect(() => writePromptToStdin(sink, "prompt", "my-provider")).not.toThrow();

    const result = writePromptToStdin(sink, "prompt", "my-provider");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error.code).toBe("AI_PROVIDER_ERROR");
    if (result.error.code !== "AI_PROVIDER_ERROR") throw new Error("unreachable");
    expect(result.error.provider).toBe("my-provider");
    expect(result.error.message).toContain("my-provider");
    expect(result.error.message).toContain("stdin write failed");
    expect(result.error.message).toContain("EPIPE: process already exited");
  });

  it("end() is NEVER called when write() itself throws — no double-fault call sequence (STATE)", () => {
    const sink = new RecordingSink({
      writeImpl: () => {
        throw new Error("EPIPE");
      },
    });

    writePromptToStdin(sink, "prompt", "claude-cli");

    expect(sink.calls).toEqual(["write:prompt"]);
  });

  it("stringifies a thrown non-Error value (a bare string) into the message without crashing", () => {
    const sink = new RecordingSink({
      writeImpl: () => {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal -- deliberately testing a non-Error throw
        throw "raw string failure, not an Error instance";
      },
    });

    const result = writePromptToStdin(sink, "prompt", "claude-cli");

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error.code).toBe("AI_PROVIDER_ERROR");
    if (result.error.code !== "AI_PROVIDER_ERROR") throw new Error("unreachable");
    expect(result.error.message).toContain("raw string failure, not an Error instance");
  });
});

// ─── STATE ──────────────────────────────────────────────────────────────────

describe("writePromptToStdin — call-sequence invariants (STATE)", () => {
  it("on success, end() is called exactly once and only after write()", () => {
    const sink = new RecordingSink();

    writePromptToStdin(sink, "prompt", "claude-cli");

    expect(sink.calls).toEqual(["write:prompt", "end"]);
    expect(sink.calls.filter((c) => c === "end")).toHaveLength(1);
  });
});

// ─── REGRESSION ─────────────────────────────────────────────────────────────

describe("writePromptToStdin — provider name propagation (REGRESSION)", () => {
  it("echoes the exact providerName into a failure result, distinguishing it from other registered providers", () => {
    const sinkA = new RecordingSink({
      writeImpl: () => {
        throw new Error("boom");
      },
    });
    const sinkB = new RecordingSink({
      writeImpl: () => {
        throw new Error("boom");
      },
    });

    const resultA = writePromptToStdin(sinkA, "prompt", "provider-a");
    const resultB = writePromptToStdin(sinkB, "prompt", "provider-b");

    expect(resultA.ok).toBe(false);
    expect(resultB.ok).toBe(false);
    if (resultA.ok || resultB.ok) throw new Error("expected both to fail");
    expect(resultA.error.code).toBe("AI_PROVIDER_ERROR");
    expect(resultB.error.code).toBe("AI_PROVIDER_ERROR");
    if (resultA.error.code !== "AI_PROVIDER_ERROR" || resultB.error.code !== "AI_PROVIDER_ERROR") {
      throw new Error("unreachable");
    }
    expect(resultA.error.provider).toBe("provider-a");
    expect(resultB.error.provider).toBe("provider-b");
  });
});
