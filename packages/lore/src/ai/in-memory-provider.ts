/**
 * In-memory AI provider test double.
 * Ships in src/ (not tests/) so any test in any package can import it without path hacks.
 * No IO — pure synchronous logic behind an async facade.
 *
 * Public surface:
 *   - InMemoryAIProviderMode — discriminated union: ok | err | sequence
 *   - InMemoryAIProviderSequenceItem — one scripted response inside a "sequence" mode
 *   - InMemoryAIProvider — implements AIProvider; records all generate() calls in this.calls
 *
 * Invariants:
 *   - setMode() replaces the current mode for all subsequent generate() calls
 *   - this.calls is appended on every generate() call, regardless of mode
 *   - The "ok" mode always resolves immediately with a fixed content string
 *   - The "err" mode always resolves with the configured error (never throws)
 *   - The "sequence" mode (SPEC-026 D9) consumes one scripted response per generate() call,
 *     FIFO order — the Nth call gets responses[N-1]. Exhausting the script (more calls than
 *     scripted responses) returns AI_PROVIDER_ERROR rather than silently repeating the last
 *     response or falling back to "ok" — a test that under-scripts its sequence is a test bug,
 *     and this fails loud instead of masking it.
 *
 * Side-effect class: stateful (in-memory only, no IO)
 *
 * Source: SPEC-017 §3.8, SPEC-026 §3 D9
 */

import { ok, err } from "@lore/core";
import type { AIProvider, GenerateInput, GenerateOutput, LoreError } from "@lore/core";
import type { Result } from "@lore/core";

// ─── Mode Discriminated Union ─────────────────────────────────────────────────

/** One scripted response inside a "sequence" mode script — same shape as the top-level modes. */
export type InMemoryAIProviderSequenceItem =
  | {
      kind: "ok";
      /** Content string to return as the generated document body */
      content: string;
      /** Optional simulated duration in ms (defaults to 0) */
      duration_ms?: number;
    }
  | {
      kind: "err";
      /** Error to return on generate() (must be AI_PROVIDER_ERROR variant) */
      error: Extract<LoreError, { code: "AI_PROVIDER_ERROR" }>;
    };

/**
 * Configures InMemoryAIProvider behaviour per call.
 * Switch modes between test assertions via setMode().
 *
 * @example
 * const provider = new InMemoryAIProvider();
 * provider.setMode({ kind: "err", error: { code: "AI_PROVIDER_ERROR", message: "binary missing", provider: "in-memory" } });
 *
 * @example
 * // SPEC-026 D9 — corrective-retry test double: first call malformed, second valid.
 * provider.setMode({
 *   kind: "sequence",
 *   responses: [
 *     { kind: "ok", content: "not json at all" },
 *     { kind: "ok", content: '{"verdict":"met","overall_score":90,"ac_scores":[],"gaps":[],"recommendations":[]}' },
 *   ],
 * });
 */
export type InMemoryAIProviderMode =
  | {
      kind: "ok";
      /** Content string to return as the generated document body */
      content: string;
      /** Optional simulated duration in ms (defaults to 0) */
      duration_ms?: number;
    }
  | {
      kind: "err";
      /** Error to return on generate() (must be AI_PROVIDER_ERROR variant) */
      error: Extract<LoreError, { code: "AI_PROVIDER_ERROR" }>;
    }
  | {
      kind: "sequence";
      /** FIFO queue of scripted responses — one consumed per generate() call (SPEC-026 D9) */
      responses: InMemoryAIProviderSequenceItem[];
    };

// ─── InMemoryAIProvider ───────────────────────────────────────────────────────

/**
 * Controllable in-memory AI provider for unit testing.
 * Records every generate() call in `this.calls` for assertion.
 *
 * @example
 * const provider = new InMemoryAIProvider("stub", { kind: "ok", content: "# Stub\n" });
 * const result = await provider.generate({ prompt: "...", doc_type: "prd", title: "X" });
 * expect(result.ok).toBe(true);
 * expect(provider.calls).toHaveLength(1);
 */
export class InMemoryAIProvider implements AIProvider {
  /** All inputs passed to generate(), in order. Used by tests for assertion. */
  public calls: GenerateInput[] = [];

  constructor(
    /** Provider name — matches registry key in tests */
    public readonly name: string = "in-memory",
    /** Initial mode — defaults to ok with stub content */
    private mode: InMemoryAIProviderMode = { kind: "ok", content: "# Stub doc\n" },
  ) {}

  /**
   * Replace the current mode for all subsequent generate() calls.
   * Does not affect already-in-flight calls (synchronous, so no race).
   *
   * @param mode - New mode to apply
   */
  setMode(mode: InMemoryAIProviderMode): void {
    this.mode = mode;
  }

  /**
   * Simulate an AI generation call. Records the input then resolves per the current mode.
   *
   * @param input - Validated generate input (same shape as ClaudeCliProvider)
   * @returns Result<GenerateOutput, LoreError> — never throws
   */
  async generate(input: GenerateInput): Promise<Result<GenerateOutput, LoreError>> {
    this.calls.push(input);

    if (this.mode.kind === "err") {
      return err(this.mode.error);
    }

    if (this.mode.kind === "sequence") {
      // reason: shift() mutates the mode's own responses array in place — FIFO consume,
      // one scripted response per call. Deliberate: setMode() is not re-called between
      // scripted calls in the corrective-retry test scenario (SPEC-026 D9), so mutating
      // in place is how "one consumed per generate() call" is actually enforced.
      const next = this.mode.responses.shift();
      if (next === undefined) {
        return err({
          code: "AI_PROVIDER_ERROR",
          provider: this.name,
          message: `InMemoryAIProvider sequence exhausted after ${this.calls.length} call(s) — script fewer calls or add more responses.`,
        });
      }
      if (next.kind === "err") {
        return err(next.error);
      }
      return ok({
        content: next.content,
        duration_ms: next.duration_ms ?? 0,
        exit_code: 0,
        provider_name: this.name,
      });
    }

    return ok({
      content: this.mode.content,
      duration_ms: this.mode.duration_ms ?? 0,
      exit_code: 0,
      provider_name: this.name,
    });
  }
}
