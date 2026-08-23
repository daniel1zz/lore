/**
 * `GhRunner` — the single `gh` subprocess seam
 * (spec-the-defect-channel-reaches-no-machine-but-its-own-github, Scope entry
 * "GhRunner"). Every future caller that needs to talk to GitHub (P2's
 * `GitHubIntakePort`, `lore setup --check`'s health probe, `lore issues
 * --verify`, the migration in P3) goes through this class — never a bare
 * `child_process` call of its own. AC-GI-7 enforces this mechanically: a
 * repo-wide literal scan for the closed token set `gh api`, `gh issue`,
 * `gh auth`, `gh repo` over `.ts` sources under `packages/lore/src` must find
 * no match outside THIS file.
 *
 * That single-seam property is also why the two remedy literals AC-GI-2
 * requires (`cli.github.com` when the `gh` binary is missing, `gh auth
 * login` when it is present but unauthenticated) are constructed ONLY here —
 * see {@link classifyGhFailure}. Parking either literal in
 * `adapters/cli/utils.ts` or `@lore/core`'s `errors.ts` would put the token
 * `gh auth` outside this file and make AC-GI-7 and AC-GI-2 mutually
 * unsatisfiable (spec round-5 revision). It is also the correct SRP split:
 * knowing HOW to remedy a broken `gh` is this runner's own knowledge: the
 * `LoreError` variants in `errors.ts` only define codes, and
 * `adapters/cli/utils.ts::formatError` only echoes `error.message` back out.
 *
 * Public surface:
 *   - `GhRunner` — constructor(`{ execFile, env? }`); `execFile` is a
 *     REQUIRED injected dependency, never a module-level default the caller
 *     can't observe or override — the real default lives in
 *     {@link createNodeGhExecFile}, a thin wrapper a production caller opts
 *     into explicitly.
 *       .run(args) — spawns `gh <args>`, scrubbing risk-R2's four
 *       attacker-influencable env vars first, and resolves a
 *       `Result<{stdout}, LoreError>` — NEVER rejects/throws.
 *   - `createNodeGhExecFile()` — the production `GhExecFile` implementation,
 *     a thin wrapper around `util.promisify(child_process.execFile)`.
 *   - `GhExecFile` / `GhExecFileOptions` / `GhExecFileResult` /
 *     `GhRunnerOptions` — the injection-point types a real caller (a later
 *     task's `GitHubIntakePort` implementation) constructs `GhRunner` with.
 *
 * Invariants:
 *   - `execFile` is called with an argv ARRAY and an explicit `maxBuffer` —
 *     never `shell: true` (Scope entry "GhRunner": shell interpolation of
 *     caller-controlled argv is a command-injection surface this seam exists
 *     to close off, on top of AC-GI-8's env-scrub).
 *   - `run()` returns raw `stdout` untouched — callers are responsible for
 *     invoking this ONLY with `gh api ...` (JSON output), never `gh issue`/
 *     `gh repo`'s human-formatted presentation output, which has already
 *     burned this codebase once via `assess-render.ts`'s ENOBUFS precedent
 *     (unbounded presentation-format text overflowing a fixed buffer).
 *   - `GH_REPO` / `GH_HOST` / `GH_CONFIG_DIR` / `GH_ENTERPRISE_TOKEN` are
 *     DELETED as OWN PROPERTY KEYS from the child's env on every call
 *     ({@link scrubGhEnv}) — risk R2: all four are attacker-influencable and
 *     let `gh` redirect a call to an attacker's repo/host/token. Deleting the
 *     key (not overwriting with `""`/`undefined`) is deliberate: a present-
 *     but-empty key still leaks shape/intent to `gh` and still satisfies a
 *     naive `typeof env.GH_HOST === "string"` probe.
 *   - `run()` never throws and never lets a rejected `execFile` promise
 *     escape — every rejection is caught and classified into a `LoreError`
 *     via {@link classifyGhFailure} (mirrors this repo's "no exceptions
 *     cross the service boundary" convention, and the child-process-to-
 *     `Result` shape already proven in `adapters/real-mcp-registrar.ts`).
 *   - Error taxonomy (checked in this exact order against the failed
 *     child's `.code`/`.stderr` — a real network failure or rate limit is
 *     reported by `gh` itself in its exit, never as a distinct Node errno
 *     the parent process could otherwise see):
 *       1. `execFile` rejects `.code === "ENOENT"` (binary missing) →
 *          `AUTH_REQUIRED`, message names `cli.github.com`.
 *       2. non-zero exit, `.stderr` contains the literal `gh auth login`
 *          (present but unauthenticated) → `AUTH_REQUIRED`, message names
 *          that same literal.
 *       3. `.stderr` contains `could not resolve host` → `TRANSPORT_UNAVAILABLE`,
 *          `retryable: true`.
 *       4. `.stderr` contains an `X-RateLimit-Reset: <epoch seconds>` line →
 *          `RATE_LIMITED`, carrying that epoch value as `.reset`.
 *       5. any other non-zero exit → the EXISTING generic `VALIDATION_ERROR`
 *          code (no new code needed), `.message` carrying a BOUNDED TAIL
 *          (last {@link STDERR_TAIL_MAX_CHARS} chars, not the head — the
 *          diagnostically useful part of a CLI failure is almost always at
 *          the end) of `.stderr`.
 *
 * Side-effect class: IO (child-process subprocess) via the injected
 * `execFile`; `scrubGhEnv`/`classifyGhFailure` are pure.
 * Source: spec-the-defect-channel-reaches-no-machine-but-its-own-github,
 *   Scope "GhRunner", risk R2, AC-GI-2, AC-GI-7, AC-GI-8.
 */

import { execFile as execFileNode } from "node:child_process";
import { promisify } from "node:util";

import { err, ok } from "@lore/core";
import type { LoreError, Result } from "@lore/core";

const execFilePromise = promisify(execFileNode);

/** The four env var names risk R2 names explicitly as attacker-influencable — AC-GI-8's closed set. */
const SCRUBBED_ENV_VAR_NAMES = ["GH_REPO", "GH_HOST", "GH_CONFIG_DIR", "GH_ENTERPRISE_TOKEN"] as const;

/**
 * Buffer sized generously above a typical `gh api` JSON response — issue
 * listing/search payloads are small compared to e.g. a git diff, but this
 * module deliberately states an EXPLICIT bound rather than relying on
 * Node's own default (the Scope entry's "explicit maxBuffer" requirement,
 * and the ENOBUFS precedent at `assess-render.ts:152` this module's own
 * doc comment cites).
 */
const MAX_BUFFER_BYTES = 10 * 1024 * 1024;

/** Bounded tail length for the generic (non-taxonomy) failure's `.stderr` excerpt. */
const STDERR_TAIL_MAX_CHARS = 1000;

/** The literal AC-GI-2 requires when the `gh` binary itself is missing. */
const GH_INSTALL_REMEDY = "gh CLI is not installed or not on PATH. Install it from https://cli.github.com and re-run.";

/** The literal AC-GI-2 requires when `gh` is present but has no logged-in account. */
const GH_AUTH_LOGIN_LITERAL = "gh auth login";

/** `gh`'s own stderr marker for a DNS/connectivity failure reaching GitHub's API (risk R2's transport half). */
const TRANSPORT_FAILURE_MARKER = "could not resolve host";

/** `gh`'s own stderr header naming when a rate-limited call may be retried. */
const RATE_LIMIT_RESET_HEADER = /X-RateLimit-Reset:\s*(\d+)/i;

/**
 * Options `execFile(args, options)` is always invoked with. Mirrors
 * `util.promisify(child_process.execFile)`'s own options shape, narrowed to
 * the two fields this module actually sets.
 */
export interface GhExecFileOptions {
  env: NodeJS.ProcessEnv;
  maxBuffer: number;
}

/** The shape a clean (exit 0) `gh` run resolves. */
export interface GhExecFileResult {
  stdout: string;
  stderr: string;
}

/**
 * The injected child-process executor `GhRunner` is constructed with.
 * REQUIRED on every `GhRunner` — there is no internal default the caller
 * can't see, precisely so a caller/test controls exactly what `gh`
 * invocation would have run without a real subprocess. On a non-zero exit
 * or a missing binary this REJECTS (never resolves) with an `Error` that
 * additionally carries `.code` (`"ENOENT"` for a missing binary, or the
 * numeric exit code otherwise) and `.stdout`/`.stderr` — the same shape
 * `util.promisify(child_process.execFile)` itself rejects with, which is
 * exactly what {@link createNodeGhExecFile} wraps.
 */
export type GhExecFile = (
  args: readonly string[],
  options: GhExecFileOptions,
) => Promise<GhExecFileResult>;

/** Constructor options for {@link GhRunner}. */
export interface GhRunnerOptions {
  /** REQUIRED — see {@link GhExecFile}'s own doc comment for why this has no internal default. */
  execFile: GhExecFile;
  /** Parent env `gh` is spawned from, BEFORE risk-R2 scrubbing. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
}

/** The rejection shape both `util.promisify(child_process.execFile)` and this module's test doubles produce. */
interface GhChildProcessFailure {
  code: number | string | undefined;
  stderr: string;
}

/**
 * Narrows an unknown `execFile` rejection into the fields
 * {@link classifyGhFailure} needs, tolerating a rejection that is not an
 * `Error` instance at all (a malformed injected test double, or a future
 * Node runtime change) rather than throwing a SECOND, less legible failure
 * on top of the first.
 */
function toGhChildProcessFailure(cause: unknown): GhChildProcessFailure {
  if (cause instanceof Error) {
    const withFields = cause as Error & { code?: number | string; stderr?: string };
    return { code: withFields.code, stderr: withFields.stderr ?? "" };
  }
  return { code: undefined, stderr: "" };
}

/** Returns the last {@link STDERR_TAIL_MAX_CHARS} characters of `text` — the diagnostically useful end, not the head. */
function boundedTail(text: string): string {
  return text.length > STDERR_TAIL_MAX_CHARS ? text.slice(-STDERR_TAIL_MAX_CHARS) : text;
}

/**
 * Classifies a failed `execFile` rejection into a `LoreError`, per the
 * five-way taxonomy this module's own header doc comment enumerates in
 * order. Pure — takes the already-caught rejection, returns a value, never
 * throws itself.
 */
function classifyGhFailure(cause: unknown): LoreError {
  const failure = toGhChildProcessFailure(cause);

  if (failure.code === "ENOENT") {
    return { code: "AUTH_REQUIRED", message: GH_INSTALL_REMEDY, retryable: false };
  }

  if (failure.stderr.includes(GH_AUTH_LOGIN_LITERAL)) {
    return {
      code: "AUTH_REQUIRED",
      message: `gh is installed but not authenticated. Run \`${GH_AUTH_LOGIN_LITERAL}\` and re-run.`,
      retryable: false,
    };
  }

  if (failure.stderr.toLowerCase().includes(TRANSPORT_FAILURE_MARKER)) {
    return {
      code: "TRANSPORT_UNAVAILABLE",
      message: `gh could not reach GitHub: ${boundedTail(failure.stderr)}`,
      retryable: true,
    };
  }

  const rateLimitMatch = RATE_LIMIT_RESET_HEADER.exec(failure.stderr);
  if (rateLimitMatch !== null) {
    return {
      code: "RATE_LIMITED",
      message: `gh reported a rate limit: ${boundedTail(failure.stderr)}`,
      reset: Number(rateLimitMatch[1]),
      retryable: true,
    };
  }

  return {
    code: "VALIDATION_ERROR",
    field: "gh",
    message: `gh exited with code ${String(failure.code ?? "unknown")}: ${boundedTail(failure.stderr)}`,
    value: failure.code,
  };
}

/**
 * Deletes the four risk-R2 env var names as OWN PROPERTY KEYS from a copy
 * of `env` — never a wholesale wipe (every other variable, including
 * `PATH`, survives untouched).
 */
function scrubGhEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const scrubbed: NodeJS.ProcessEnv = { ...env };
  for (const name of SCRUBBED_ENV_VAR_NAMES) {
    delete scrubbed[name];
  }
  return scrubbed;
}

/**
 * The production {@link GhExecFile} — a thin wrapper around
 * `util.promisify(child_process.execFile)` bound to the `gh` binary name,
 * with an argv ARRAY (never a shell string) and UTF-8 decoding. A real
 * caller (a later task's `GitHubIntakePort` implementation) opts into this
 * explicitly via `new GhRunner({ execFile: createNodeGhExecFile() })` — it
 * is never the constructor's implicit default (see {@link GhExecFile}).
 */
export function createNodeGhExecFile(): GhExecFile {
  return async (args, options) => {
    const { stdout, stderr } = await execFilePromise("gh", [...args], {
      env: options.env,
      maxBuffer: options.maxBuffer,
      encoding: "utf8",
    });
    return { stdout, stderr };
  };
}

/**
 * The single `gh` subprocess seam. See this module's header doc comment for
 * the full contract (env-scrub, error taxonomy, argv/shell invariants).
 */
export class GhRunner {
  private readonly execFile: GhExecFile;
  private readonly env: NodeJS.ProcessEnv;

  constructor(options: GhRunnerOptions) {
    this.execFile = options.execFile;
    this.env = options.env ?? process.env;
  }

  /**
   * Runs `gh <args>` with a scrubbed env and an explicit `maxBuffer`.
   * NEVER rejects — every failure (missing binary, non-zero exit) is
   * classified into a `LoreError` and returned as `err(...)`.
   *
   * @param args - `gh` argv, e.g. `["api", "user"]`. Callers MUST pass only
   *   `gh api` invocations (JSON output) — never `gh issue`/`gh repo`'s
   *   human-formatted presentation output (this module's own doc comment
   *   explains why).
   */
  async run(args: readonly string[]): Promise<Result<{ stdout: string }, LoreError>> {
    const scrubbedEnv = scrubGhEnv(this.env);
    try {
      const { stdout } = await this.execFile(args, { env: scrubbedEnv, maxBuffer: MAX_BUFFER_BYTES });
      return ok({ stdout });
    } catch (cause) {
      return err(classifyGhFailure(cause));
    }
  }
}
