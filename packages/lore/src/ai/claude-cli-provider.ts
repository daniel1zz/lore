/**
 * Claude CLI AI provider — spawns `claude -p` (or any configured command) as a subprocess,
 * writes the rendered prompt to its stdin, and captures stdout as the generated document body.
 *
 * Public surface:
 *   - ClaudeCliProvider — implements AIProvider via Bun.spawn (bun-only, not vitest-reachable)
 *   - writePromptToStdin — pure stdin write+close+catch helper (BUG-013), vitest-reachable
 *     (takes a structural `StdinSink`, not a real `Bun.FileSink`)
 *
 * Invariants:
 *   - Imports AIProvider from @lore/core (cross-package via package name), NOT via relative path (AC-AI-13)
 *   - Spawn parameters (command/args/cwd/env) come from `buildHermeticSpawnSpec` (hermetic-spawn.ts)
 *     — the ONLY place that owns cwd/env sanitization logic (SPEC-030 AC-HJ-1). This class never
 *     builds spawn params inline so those params stay unit-testable under vitest.
 *   - The judge subprocess runs hermetically: neutral cwd (OS tmpdir), sanitized env (no
 *     CLAUDECODE / CLAUDE_* leakage), and — for the `claude` binary specifically — the official
 *     `--setting-sources ""` isolation flag. See hermetic-spawn.ts module header for the full
 *     rationale and the `--bare` alternative that was probed and rejected.
 *   - SIGTERM is sent after timeout_ms via clearTimeout-safe watchdog
 *   - All failure paths (spawn error, non-zero exit, empty stdout, timeout, stdin write) return
 *     Result errors
 *   - Never throws — all errors are wrapped in err({ code: "AI_PROVIDER_ERROR", ... }), INCLUDING
 *     a synchronous stdin-write failure (BUG-013 fix — `writePromptToStdin` is the sole stdin
 *     write site, catching what used to propagate uncaught on an EPIPE)
 *
 * Side-effect class: IO (Bun.spawn, stdin/stdout/stderr pipes)
 *
 * Source: SPEC-017 §3.7, SPEC-030 AC-HJ-1/AC-HJ-2/AC-HJ-4
 */

import { ok, err } from "@lore/core";
import type { AIProvider, AiProviderConfig, GenerateInput, GenerateOutput, LoreError } from "@lore/core";
import type { Result } from "@lore/core";
import { buildHermeticSpawnSpec } from "./hermetic-spawn.js";

// ─── ClaudeCliProvider ────────────────────────────────────────────────────────

/**
 * CLI-spawning AI provider. Generic over (command, args, timeout_ms) so the same class
 * works for any provider whose interface is: prompt → stdin, content → stdout.
 *
 * v1 design choice: all known providers use ClaudeCliProvider. A future SPEC will add a
 * `kind` discriminator on AiProviderConfig and a separate HttpProvider class.
 * See SPEC-017 §3.5 for the deliberate deferral.
 *
 * @example
 * const provider = new ClaudeCliProvider("claude-cli", {
 *   command: "claude", args: ["-p"], timeout_ms: 60_000,
 * });
 * const result = await provider.generate({ prompt: "Write a PRD...", doc_type: "prd", title: "X" });
 */
/**
 * Minimal structural surface this module needs from a spawned process's stdin
 * pipe — matches `Bun.FileSink`'s `write`/`end` shape without requiring the
 * real Bun type, so {@link writePromptToStdin} is plain-TS testable (vitest, no
 * real subprocess) instead of only reachable via a live `Bun.spawn` (BUG-013
 * regression coverage).
 */
export interface StdinSink {
  write(data: string): number | Promise<number>;
  end(): number | Promise<number> | void;
}

/**
 * Writes `prompt` to `sink` and closes it (EOF signal) — the ONE stdin
 * interaction {@link ClaudeCliProvider.generate} performs. Wraps both calls in
 * try/catch: a synchronous EPIPE (the spawned process crashed or closed its
 * stdin before the write finished — e.g. the configured command fails
 * immediately) previously propagated straight past `generate()`, contradicting
 * this module's own "Never throws" contract (BUG-013).
 *
 * @param sink - The spawned process's stdin (a `Bun.FileSink` in production).
 * @param prompt - Prompt text to write.
 * @param providerName - Registry key, echoed into the error for diagnosis.
 * @returns `ok(undefined)` on success, `err(AI_PROVIDER_ERROR)` naming the
 *   provider and the underlying write failure otherwise. Never throws.
 */
export function writePromptToStdin(
  sink: StdinSink,
  prompt: string,
  providerName: string,
): Result<void, LoreError> {
  try {
    sink.write(prompt);
    sink.end();
    return ok(undefined);
  } catch (error) {
    return err({
      code: "AI_PROVIDER_ERROR",
      provider: providerName,
      message: `provider "${providerName}" stdin write failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    });
  }
}

export class ClaudeCliProvider implements AIProvider {
  constructor(
    /** Registry key for this provider — returned in GenerateOutput.provider_name */
    public readonly name: string,
    /** Provider config from the merged registry (built-in defaults or user override) */
    private readonly cfg: AiProviderConfig,
    /** The invocation's environment and temp directory the hermetic spawn spec is built from. */
    private readonly runtime: { readonly env: Readonly<Record<string, string | undefined>>; readonly tmpDir: string },
  ) {}

  /**
   * Spawn the configured command, pipe the prompt to stdin, and capture stdout.
   *
   * Failure cases (all return err({ code: "AI_PROVIDER_ERROR" })):
   *   - Bun.spawn throws (binary missing / ENOENT) → message: "command not found: <cmd>"
   *   - Process exits non-zero → exit_code and first 1024 chars of stderr included
   *   - Process times out (exceeds timeout_ms) → killed with SIGTERM
   *   - stdout is empty or whitespace-only → "produced empty output"
   *
   * @param input - Validated generate input from AIProviderService
   * @returns Result<GenerateOutput, LoreError> — never throws
   */
  async generate(input: GenerateInput): Promise<Result<GenerateOutput, LoreError>> {
    const t0 = performance.now();

    // SPEC-030 AC-HJ-1: spawn params (command/args/cwd/env) come from the pure builder —
    // this callsite never inlines cwd/env logic so that logic stays vitest-testable.
    const spawnSpec = buildHermeticSpawnSpec(this.cfg, { sourceEnv: this.runtime.env, tmpDir: this.runtime.tmpDir });

    // Attempt to spawn — catches ENOENT (binary not on PATH)
    let proc: ReturnType<typeof Bun.spawn>;
    try {
      proc = Bun.spawn([spawnSpec.command, ...spawnSpec.args], {
        cwd: spawnSpec.cwd,
        env: spawnSpec.env,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });
    } catch {
      return err({
        code: "AI_PROVIDER_ERROR",
        provider: this.name,
        message: `command not found: ${this.cfg.command}`,
      });
    }

    // Timeout watchdog — sends SIGTERM after timeout_ms if the process is still running
    // reason: must capture the timer id so we can clearTimeout on normal completion;
    // otherwise the timer fires after the function returns, killing an unrelated process.
    // reason: timedOut flag is set by the closure before killing — allows the error message
    // to distinguish a timeout ("timed out after Nms") from a normal non-zero exit ("exited N").
    // Without this flag, both paths produce the same generic "exited N" message (AC-AI-8).
    let timedOut = false;
    const killer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGTERM");
    }, this.cfg.timeout_ms);

    // Write prompt to stdin and close — signals EOF so the provider starts generating
    // reason: Bun.spawn option `stdin: "pipe"` guarantees proc.stdin is a FileSink,
    // but the generic SubProcess type is `number | FileSink | undefined`. Type assertion
    // is safe here because we always pass stdin: "pipe" in the spawn options above.
    const procStdin = proc.stdin as import("bun").FileSink;
    const stdinResult = writePromptToStdin(procStdin, input.prompt, this.name);
    if (!stdinResult.ok) {
      // BUG-013: a synchronous stdin-write failure (e.g. EPIPE — the process
      // already exited/closed stdin) previously propagated uncaught past this
      // method. Clear the watchdog and best-effort-kill the process so no
      // orphaned child or stale timer survives a caught write failure, same
      // cleanup the timeout/non-zero-exit paths below already perform.
      clearTimeout(killer);
      proc.kill("SIGTERM");
      return stdinResult;
    }

    // Capture stdout + stderr concurrently with process exit code.
    // reason: Bun.spawn option `stdout/stderr: "pipe"` guarantees ReadableStream,
    // but the generic SubProcess type allows number | ReadableStream | undefined.
    const [stdout, stderr, exit_code] = await Promise.all([
      new Response(proc.stdout as ReadableStream<Uint8Array>).text(),
      new Response(proc.stderr as ReadableStream<Uint8Array>).text(),
      proc.exited,
    ]);
    clearTimeout(killer);

    const duration_ms = Math.round(performance.now() - t0);

    if (exit_code !== 0) {
      return err({
        code: "AI_PROVIDER_ERROR",
        provider: this.name,
        exit_code,
        // reason: truncate stderr at 1024 chars to keep LoreError payloads bounded
        stderr: stderr.slice(0, 1024),
        // reason: timedOut distinguishes a watchdog kill from a provider's own non-zero exit —
        // user needs to know "timeout" vs "failed" to take different corrective actions (AC-AI-8).
        // The word "timeout" must appear literally so callers (tests, tooling) can detect it
        // without parsing the numeric exit code.
        // SPEC-030 AC-HJ-4: name the actual configured timeout_ms value AND the exact config
        // knob to raise it, AND the entry-REPLACES-built-in semantics — a provider override
        // under `ai.providers.<name>` replaces the WHOLE built-in entry, so a reader who adds
        // only `timeout_ms` without restating `command`/`args` silently loses those fields
        // (this is the exact silent-fallback failure mode SPEC-030 §1.2/§1.3 calls out).
        message: timedOut
          ? `provider "${this.name}" timeout: process killed after ${this.cfg.timeout_ms}ms. ` +
            `Raise the limit via ai.providers.${this.name}.timeout_ms in .lore/config.yaml — ` +
            `NOTE: that config entry REPLACES the built-in provider entry entirely (no merge), ` +
            `so you must also restate command and args alongside the new timeout_ms, e.g.: ` +
            `ai.providers.${this.name}: { command: ${this.cfg.command}, args: ${JSON.stringify(this.cfg.args)}, timeout_ms: <new value> }`
          : `provider "${this.name}" exited ${exit_code}`,
      });
    }

    if (stdout.trim() === "") {
      return err({
        code: "AI_PROVIDER_ERROR",
        provider: this.name,
        exit_code,
        message: `provider "${this.name}" produced empty output`,
      });
    }

    return ok({
      content: stdout,
      duration_ms,
      exit_code,
      provider_name: this.name,
    });
  }
}
