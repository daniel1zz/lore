/**
 * RED scenarios for `GhRunner` — the single `gh` subprocess seam scoped by
 * spec-the-defect-channel-reaches-no-machine-but-its-own-github (Scope entry
 * "GhRunner"). `packages/lore/src/service/gh-runner.ts` does NOT exist yet —
 * that is deliberate. This suite is authored by
 * task-skill-test-ghrunner-auth-env-scrub-and-error-taxonomy-red; the paired
 * task-skill-implement-ghrunner-as-the-single-gh-subprocess-seam is the ONLY
 * task allowed to create that file. Until it lands, every case below fails
 * with "Cannot find module '.../gh-runner.js'" — a missing-module failure,
 * never an assertion authored against the wrong contract.
 *
 * Covers AC-GI-2 (auth taxonomy: missing binary vs unauthenticated) plus the
 * three-way error taxonomy the task's dispatch names explicitly: a generic
 * non-zero exit (reuses the EXISTING `VALIDATION_ERROR` code — no new code
 * needed), `TRANSPORT_UNAVAILABLE` (retryable), and `RATE_LIMITED` (carries a
 * `reset` value). `GH_*` env scrubbing (AC-GI-8) has its own dedicated file,
 * gh-runner-env-scrub.test.ts, per this spec's oracle-per-file convention
 * (round 4 revision 16: "one AC covering [several things] can pass while
 * testing only [one]").
 *
 * Dependency-injection contract this suite pins on `GhRunner` (the exported
 * class is the only value import required to exist — everything else here is
 * a locally-typed test double, so the paired implementer keeps freedom over
 * internal type names):
 *   - `new GhRunner({ execFile, env? })` — `execFile` is REQUIRED, never a
 *     module-level default the test can't observe. `execFile(args, {env,
 *     maxBuffer})` resolves `{stdout, stderr}` on a clean exit, or REJECTS
 *     with an `Error` carrying `.code` (`"ENOENT"` when the binary itself is
 *     missing, or the numeric exit code on a non-zero exit) and `.stdout` /
 *     `.stderr` — the same shape `util.promisify(child_process.execFile)`
 *     produces, so the production default can be a thin wrapper around it.
 *   - `runner.run(args)` resolves `Result<{stdout: string}, LoreError>` —
 *     NEVER rejects (mirrors the repo's "no exceptions cross the service
 *     boundary" convention; also proven by scenario 3 below, which throws
 *     from the injected `execFile` and still expects a resolved `Result`).
 *
 * Error-taxonomy discriminators this suite requires `GhRunner.run` to
 * implement (the exact literal strings a correct implementation must match
 * against the failed child's `stderr`, since a real network failure or rate
 * limit is reported by `gh` itself in the exit, never as a distinct Node
 * errno the parent process can see):
 *   1. `execFile` rejects with `.code === "ENOENT"` → `AUTH_REQUIRED`,
 *      message contains the literal `cli.github.com` (binary missing).
 *   2. `execFile` rejects with a non-zero exit whose `.stderr` contains the
 *      literal `gh auth login` → `AUTH_REQUIRED`, message contains that same
 *      literal (present but unauthenticated).
 *   3. Any other non-zero exit → `VALIDATION_ERROR`, `.message` carries a
 *      BOUNDED TAIL of `.stderr` (proven by feeding stderr far longer than
 *      any reasonable bound and asserting the returned message is shorter
 *      than the input yet still contains the input's tail marker).
 *   4. `.stderr` contains the literal `could not resolve host` →
 *      `TRANSPORT_UNAVAILABLE`, `retryable: true`, and — the AC's own
 *      wording — distinct from `AUTH_REQUIRED`.
 *   5. `.stderr` contains `X-RateLimit-Reset: <epoch seconds>` →
 *      `RATE_LIMITED`, carrying that exact epoch value as `.reset`.
 *
 * @spec_ref AC-GI-2, spec-the-defect-channel-reaches-no-machine-but-its-own-github
 */

import { describe, expect, it } from "vitest";

import { GhRunner } from "../../../src/service/gh-runner.js";

// ─── Local test-double types (structural — no export requirement on the
// implementation beyond the `GhRunner` class itself) ────────────────────────

interface GhExecFileOptions {
  env: NodeJS.ProcessEnv;
  maxBuffer: number;
}

interface GhExecFileResult {
  stdout: string;
  stderr: string;
}

type GhExecFile = (args: readonly string[], options: GhExecFileOptions) => Promise<GhExecFileResult>;

interface GhExecFileErrorProps {
  code: number | string;
  stderr?: string;
  stdout?: string;
  message?: string;
}

/** Builds the rejection shape `util.promisify(child_process.execFile)` produces on a failed run. */
function ghExecFileError(props: GhExecFileErrorProps): Error & { code: number | string; stdout: string; stderr: string } {
  const error = new Error(props.message ?? `gh exited with code ${String(props.code)}`) as Error & {
    code: number | string;
    stdout: string;
    stderr: string;
  };
  error.code = props.code;
  error.stdout = props.stdout ?? "";
  error.stderr = props.stderr ?? "";
  return error;
}

const BASE_ENV: NodeJS.ProcessEnv = { PATH: "/usr/bin:/bin" };

describe("GhRunner auth taxonomy (AC-GI-2, spec-the-defect-channel-reaches-no-machine-but-its-own-github)", () => {
  it("gh binary absent from PATH -> AUTH_REQUIRED naming cli.github.com, never the generic VALIDATION_ERROR bucket", async () => {
    const execFile: GhExecFile = async () => {
      throw ghExecFileError({ code: "ENOENT", message: "spawn gh ENOENT" });
    };

    const runner = new GhRunner({ execFile, env: BASE_ENV });
    const result = await runner.run(["api", "user"]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("AUTH_REQUIRED");
    expect((result.error as { retryable?: boolean }).retryable).toBe(false);
    expect(JSON.stringify(result.error)).toContain("cli.github.com");
  });

  it("gh present but unauthenticated -> AUTH_REQUIRED naming gh auth login, never a generic non-zero-exit failure", async () => {
    const execFile: GhExecFile = async () => {
      throw ghExecFileError({
        code: 1,
        stderr: "To get started with GitHub CLI, please run:  gh auth login\n",
      });
    };

    const runner = new GhRunner({ execFile, env: BASE_ENV });
    const result = await runner.run(["api", "user"]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("AUTH_REQUIRED");
    expect((result.error as { retryable?: boolean }).retryable).toBe(false);
    expect(JSON.stringify(result.error)).toContain("gh auth login");
  });
});

describe("GhRunner error taxonomy (generic / transport / rate-limit — distinct codes, never a throw)", () => {
  it("a non-zero exit with ordinary stderr text resolves err(VALIDATION_ERROR) carrying a BOUNDED TAIL of stderr, and does not throw", async () => {
    const tailMarker = "END-OF-STDERR-TAIL-MARKER";
    const hugeStderr = "x".repeat(20_000) + tailMarker;

    const execFile: GhExecFile = async () => {
      throw ghExecFileError({ code: 1, stderr: hugeStderr });
    };

    const runner = new GhRunner({ execFile, env: BASE_ENV });
    // No try/catch: a thrown rejection here would fail this test on its own,
    // which is exactly the "rather than throwing" half of the scenario.
    const result = await runner.run(["api", "user"]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("VALIDATION_ERROR");
    const rendered = JSON.stringify(result.error);
    expect(rendered).toContain(tailMarker);
    expect(rendered.length).toBeLessThan(hugeStderr.length);
    expect(rendered.length).toBeLessThanOrEqual(2000);
  });

  it("a network-level failure (stderr: could not resolve host) -> TRANSPORT_UNAVAILABLE, retryable, and distinct from AUTH_REQUIRED", async () => {
    const execFile: GhExecFile = async () => {
      throw ghExecFileError({ code: 1, stderr: "gh: could not resolve host: api.github.com\n" });
    };

    const runner = new GhRunner({ execFile, env: BASE_ENV });
    const result = await runner.run(["api", "user"]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("TRANSPORT_UNAVAILABLE");
    expect(result.error.code).not.toBe("AUTH_REQUIRED");
    expect((result.error as { retryable?: boolean }).retryable).toBe(true);
  });

  it("a 403 rate-limit response -> RATE_LIMITED carrying the parsed reset value", async () => {
    const resetEpochSeconds = 1755999999;
    const execFile: GhExecFile = async () => {
      throw ghExecFileError({
        code: 1,
        stderr: `gh: API rate limit exceeded for user ID 12345. (HTTP 403)\nX-RateLimit-Reset: ${String(resetEpochSeconds)}\n`,
      });
    };

    const runner = new GhRunner({ execFile, env: BASE_ENV });
    const result = await runner.run(["api", "user"]);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("RATE_LIMITED");
    expect((result.error as { reset?: number }).reset).toBe(resetEpochSeconds);
  });
});
