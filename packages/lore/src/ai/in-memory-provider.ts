/**
 * In-memory AI provider test double.
 * Ships in src/ (not tests/) so any test in any package can import it without path hacks.
 * No IO — pure synchronous logic behind an async facade.
 *
 * Public surface:
 *   - InMemoryAIProviderMode — discriminated union: ok | err
 *   - InMemoryAIProvider — implements AIProvider; records all generate() calls in this.calls
 *
 * Invariants:
 *   - setMode() replaces the current mode for all subsequent generate() calls
 *   - this.calls is appended on every generate() call, regardless of mode
 *   - The "ok" mode always resolves immediately with a fixed content string
 *   - The "err" mode always resolves with the configured error (never throws)
 *
 * Side-effect class: stateful (in-memory only, no IO)
 *
 * Source: SPEC-017 §3.8
 */

import { ok, err } from "@lore/core";
import type { AIProvider, GenerateInput, GenerateOutput, LoreError } from "@lore/core";
import type { Result } from "@lore/core";

// ─── Mode Discriminated Union ─────────────────────────────────────────────────

/**
 * Configures InMemoryAIProvider behaviour per call.
 * Switch modes between test assertions via setMode().
 *
 * @example
 * const provider = new InMemoryAIProvider();
 * provider.setMode({ kind: "err", error: { code: "AI_PROVIDER_ERROR", message: "binary missing", provider: "in-memory" } });
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

    return ok({
      content: this.mode.content,
      duration_ms: this.mode.duration_ms ?? 0,
      exit_code: 0,
      provider_name: this.name,
    });
  }
}
