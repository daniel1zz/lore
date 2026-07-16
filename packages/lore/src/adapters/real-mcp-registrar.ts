/**
 * Real `McpRegistrar` (SPEC-046 §Design, P1 port implementation) — shells the
 * `claude` CLI to register/de-register the `lore` MCP server at user scope,
 * via `Bun.spawn` and `@lore/core`'s pure argv builders
 * (`buildMcpAddArgs`/`buildMcpRemoveArgs`, `register-mcp.ts`).
 *
 * Public surface:
 *   - RealMcpRegistrar implements McpRegistrar — constructor() (no params;
 *     the `claude` command is resolved via PATH, mirroring `ClaudeCliProvider`)
 *
 * Invariants:
 *   - Never throws — `add`/`remove` always resolve to a `Result`, mirroring
 *     `SetupService`'s own "MCP registration failure is NEVER thrown, records
 *     mcp: 'failed'" contract (the CALLER decides how to react; this port
 *     itself never aborts a process).
 *   - `claude` not on `PATH` (Bun.spawn throws ENOENT-shaped) →
 *     `err(VALIDATION_ERROR)` naming the EXACT manual command an operator can
 *     run themselves (`claude mcp add -s user lore -- <binPath> --mcp-server`
 *     / `claude mcp remove -s user lore`) — never a bare "command not found",
 *     since the whole point of this port failing is that the user needs a
 *     literal fallback command, not just a diagnosis.
 *   - A non-zero exit is `err(VALIDATION_ERROR)` carrying up to 500 chars of
 *     stderr (mirrors `claude-cli-provider.ts`'s stderr-tail truncation
 *     precedent, at a smaller cap since this is a short CLI subcommand, not a
 *     generation call).
 *   - argv is built EXCLUSIVELY via `buildMcpAddArgs`/`buildMcpRemoveArgs` —
 *     this class never inlines `["mcp", "add", ...]` itself, so the argv
 *     contract stays defined in exactly one (pure, vitest-tested) place.
 *
 * Side-effect class: IO (Bun.spawn subprocess).
 * Source: SPEC-046 §Design ("Global MCP registration via `claude mcp add`").
 */

import { buildMcpAddArgs, buildMcpRemoveArgs, err, ok } from "@lore/core";
import type { Result, LoreError } from "@lore/core";

import type { McpRegistrar } from "../service/setup-service.js";

const CLAUDE_COMMAND = "claude";
const STDERR_TAIL_MAX_CHARS = 500;

/** The literal manual fallback for `add(binPath)` — surfaced verbatim in the error message when `claude` is unreachable. */
function manualAddCommand(binPath: string): string {
  return `claude ${buildMcpAddArgs(binPath).join(" ")}`;
}

/** The literal manual fallback for `remove()` — surfaced verbatim in the error message when `claude` is unreachable. */
function manualRemoveCommand(): string {
  return `claude ${buildMcpRemoveArgs().join(" ")}`;
}

/**
 * Runs `claude` with the given argv and reports the outcome as a `Result`.
 * Shared by `add`/`remove` — the only difference between the two public
 * methods is which argv builder + manual-command renderer they pass in.
 */
async function runClaudeMcpCommand(args: string[], manualCommand: string): Promise<Result<void, LoreError>> {
  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn([CLAUDE_COMMAND, ...args], { stdout: "pipe", stderr: "pipe" });
  } catch {
    return err({
      code: "VALIDATION_ERROR",
      field: "claude",
      message:
        `"claude" CLI not found on PATH — could not run the MCP registration step. ` +
        `Run it manually: ${manualCommand}`,
      value: CLAUDE_COMMAND,
    });
  }

  const [stderr, exitCode] = await Promise.all([
    new Response(proc.stderr as ReadableStream<Uint8Array>).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    return err({
      code: "VALIDATION_ERROR",
      field: "claude",
      message:
        `"claude ${args.join(" ")}" exited ${exitCode}: ${stderr.slice(0, STDERR_TAIL_MAX_CHARS)}. ` +
        `Run it manually: ${manualCommand}`,
      value: exitCode,
    });
  }

  return ok(undefined);
}

/**
 * `Bun.spawn`-backed {@link McpRegistrar}. See module doc for the
 * ENOENT/nonzero-exit contract.
 */
export class RealMcpRegistrar implements McpRegistrar {
  async add(binPath: string): Promise<Result<void, LoreError>> {
    return runClaudeMcpCommand(buildMcpAddArgs(binPath), manualAddCommand(binPath));
  }

  async remove(): Promise<Result<void, LoreError>> {
    return runClaudeMcpCommand(buildMcpRemoveArgs(), manualRemoveCommand());
  }
}
