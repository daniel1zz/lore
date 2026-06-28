/**
 * Claude CLI AI provider — spawns `claude -p` (or any configured command) as a subprocess,
 * writes the rendered prompt to its stdin, and captures stdout as the generated document body.
 *
 * Public surface:
 *   - ClaudeCliProvider — implements AIProvider via Bun.spawn (bun-only, not vitest-reachable)
 *
 * Invariants:
 *   - Imports AIProvider from @lore/core (cross-package via package name), NOT via relative path (AC-AI-13)
 *   - Spawns the configured command with configured args; prompt is written to stdin
 *   - SIGTERM is sent after timeout_ms via clearTimeout-safe watchdog
 *   - All failure paths (spawn error, non-zero exit, empty stdout, timeout) return Result errors
 *   - Never throws — all errors are wrapped in err({ code: "AI_PROVIDER_ERROR", ... })
 *
 * Side-effect class: IO (Bun.spawn, stdin/stdout/stderr pipes)
 *
 * Source: SPEC-017 §3.7
 */

import { ok, err } from "@lore/core";
import type { AIProvider, AiProviderConfig, GenerateInput, GenerateOutput, LoreError } from "@lore/core";
import type { Result } from "@lore/core";

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
export class ClaudeCliProvider implements AIProvider {
  constructor(
    /** Registry key for this provider — returned in GenerateOutput.provider_name */
    public readonly name: string,
    /** Provider config from the merged registry (built-in defaults or user override) */
    private readonly cfg: AiProviderConfig,
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

    // Attempt to spawn — catches ENOENT (binary not on PATH)
    let proc: ReturnType<typeof Bun.spawn>;
    try {
      proc = Bun.spawn([this.cfg.command, ...this.cfg.args], {
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
    const killer = setTimeout(() => proc.kill("SIGTERM"), this.cfg.timeout_ms);

    // Write prompt to stdin and close — signals EOF so the provider starts generating
    // reason: Bun.spawn option `stdin: "pipe"` guarantees proc.stdin is a FileSink,
    // but the generic SubProcess type is `number | FileSink | undefined`. Type assertion
    // is safe here because we always pass stdin: "pipe" in the spawn options above.
    const procStdin = proc.stdin as import("bun").FileSink;
    procStdin.write(input.prompt);
    procStdin.end();

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
        message: `provider "${this.name}" exited ${exit_code}`,
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
