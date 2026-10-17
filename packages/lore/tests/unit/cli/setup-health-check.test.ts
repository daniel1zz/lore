/**
 * RED scaffold for `lore setup --check`'s GitHub-channel health probe
 * (SPEC-the-defect-channel-reaches-no-machine-but-its-own-github, Migration
 * Plan P0: "read-only health check in `lore setup --check`"; AC-GI-2's
 * PRE-FLIGHT discoverability half — the runtime refusal path on an actual
 * `lore report-issue` is a SEPARATE task's concern, see
 * task-skill-implement-ghrunner-as-the-single-gh-subprocess-seam).
 *
 * TDD-Role: red. Paired-Impl:
 * task-skill-implement-lore-setup-check-read-only-health-probe, whose own
 * AC #1 is literally "given the anchored test file from the paired red
 * task, when it runs, then all cases pass" — THIS file is that target, and
 * it therefore PINS the exact contract the implementation must create:
 *
 *   packages/lore/src/adapters/cli/setup-github-health.ts
 *     export interface GhHealthProbeRunner {
 *       run(args: string[]): Promise<GhHealthRunResult>;
 *     }
 *     export type GhHealthRunResult =
 *       | { ok: true; stdout: string }
 *       | { ok: false; reason: "not-found" }      // gh absent from PATH (ENOENT)
 *       | { ok: false; reason: "auth-required" }   // gh present, not logged in
 *       | { ok: false; reason: "error"; message: string }; // anything else (e.g. repo unreadable)
 *     export type GhHealthCondition = "gh-missing" | "gh-unauthenticated" | "repo-unreadable" | "healthy";
 *     export interface GhHealthCheckReport {
 *       ok: boolean;
 *       condition: GhHealthCondition;
 *       remedy?: string;   // present only for "gh-missing" ("cli.github.com") and "gh-unauthenticated" ("gh auth login")
 *       message: string;
 *     }
 *     export function runGitHubHealthCheck(opts: { runner: GhHealthProbeRunner }): Promise<GhHealthCheckReport>;
 *
 * Deliberately a NEW sibling module (mirrors `setup-check.ts`/`setup-args.ts`
 * sitting next to `commands/setup.ts`, never inside it — this module's own
 * CLAUDE.md: "no business logic" belongs in `commands/`) rather than an
 * addition to `commands/setup.ts` — that file is anchor-locked to the paired
 * implementation task, but creating a NEW file conflicts with no declared
 * anchor, and the implementer still edits `commands/setup.ts` for the
 * one-line `--check` dispatch wiring, exactly as `runSetupCheck` is wired in
 * today.
 *
 * `runGitHubHealthCheck` MUST take the runner as a REQUIRED constructor-style
 * parameter with no default that reaches for a real subprocess — every test
 * below injects a fake and none may spawn `gh` for real (CI/sandboxes never
 * have `gh` authenticated against a real target repo).
 *
 * The four scenarios below are copied verbatim from this task's `Scenarios:`
 * field (the contract) — do not add, remove, or reword them without a
 * corresponding task update.
 *
 * Coverage: HAPPY (all-satisfied → healthy, zero writes), NEGATIVE (each of
 *   the three failure preconditions), BOUNDARY (repo-unreadable must not
 *   collapse into auth-required — the two failure conditions share nothing
 *   but "ok: false"), STATE (the mutating-verb guard is itself exercised by
 *   a dedicated falsifier case, proving it can actually go red before it is
 *   trusted to stay green).
 *
 * @spec_ref spec-the-defect-channel-reaches-no-machine-but-its-own-github#AC-GI-2
 */

import { describe, expect, it } from "vitest";

import type {
  GhHealthCheckReport,
  GhHealthProbeRunner,
  GhHealthRunResult,
} from "../../../src/adapters/cli/setup-github-health.js";
import { runGitHubHealthCheck } from "../../../src/adapters/cli/setup-github-health.js";

// ─── Mutating-verb guard (test-fixture only — NOT the production probe) ────
//
// Structural, not hopeful: every fake runner below records EVERY invocation
// into `mutatingCalls` the instant it recognises a write verb, BEFORE
// invoking `script()` or throwing. A production implementation that
// defensively catches the thrown error and converts it into an ordinary
// `{ ok: false }` report would still be caught — the assertion is against
// the independent `mutatingCalls` record, never against how the call site
// happened to react.

const MUTATING_METHOD_VALUES = new Set(["POST", "PATCH", "PUT", "DELETE"]);

const MUTATING_NOUN_VERBS: Readonly<Record<string, ReadonlySet<string>>> = {
  issue: new Set(["create", "edit", "close", "reopen", "comment", "delete", "transfer", "pin", "unpin", "lock", "unlock"]),
  repo: new Set(["create", "delete", "edit", "rename", "archive", "unarchive", "clone", "fork"]),
  pr: new Set(["create", "edit", "close", "reopen", "merge", "comment", "review"]),
  label: new Set(["create", "edit", "delete"]),
  release: new Set(["create", "edit", "delete", "upload"]),
  gist: new Set(["create", "edit", "delete"]),
};

/** True for any `gh` argv this suite considers a WRITE. Exercised directly by the falsifier case below. */
function isMutatingGhInvocation(args: readonly string[]): boolean {
  if (args[0] === "api") {
    const methodFlagIndex = args.findIndex((a) => a === "--method" || a === "-X");
    if (methodFlagIndex === -1) return false;
    const value = (args[methodFlagIndex + 1] ?? "").toUpperCase();
    return MUTATING_METHOD_VALUES.has(value);
  }
  const noun = args[0];
  const verb = args[1];
  if (noun === undefined || verb === undefined) return false;
  const verbs = MUTATING_NOUN_VERBS[noun];
  return verbs !== undefined && verbs.has(verb);
}

interface RecordedCall {
  args: string[];
}

/**
 * Builds a fake `GhHealthProbeRunner` around a scripted response function.
 * Returns the runner plus TWO independent observation arrays: `calls` (every
 * invocation, for "did it actually probe?" assertions that rule out a
 * vacuous pass) and `mutatingCalls` (populated structurally, before any
 * throw/catch can intervene, for the no-write guarantee).
 */
function createGuardedRunner(script: (args: string[]) => GhHealthRunResult): {
  runner: GhHealthProbeRunner;
  calls: RecordedCall[];
  mutatingCalls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const mutatingCalls: RecordedCall[] = [];
  const runner: GhHealthProbeRunner = {
    async run(args: string[]): Promise<GhHealthRunResult> {
      calls.push({ args });
      if (isMutatingGhInvocation(args)) {
        mutatingCalls.push({ args });
        throw new Error(
          `setup-health-check RED guard: a read-only health check invoked a MUTATING gh verb: gh ${args.join(" ")}`,
        );
      }
      return script(args);
    },
  };
  return { runner, calls, mutatingCalls };
}

function isVersionProbe(args: readonly string[]): boolean {
  return args[0] === "--version";
}
function isAuthStatusProbe(args: readonly string[]): boolean {
  return args[0] === "auth" && args[1] === "status";
}
function isRateLimitProbe(args: readonly string[]): boolean {
  return args[0] === "api" && args.includes("rate_limit");
}
function isRepoReadProbe(args: readonly string[]): boolean {
  return args[0] === "api" && !isRateLimitProbe(args);
}

// ─── Scenario 1: gh absent from PATH ────────────────────────────────────────

function scriptGhMissing(_args: string[]): GhHealthRunResult {
  // Every invocation ENOENTs identically — the binary simply is not there.
  return { ok: false, reason: "not-found" };
}

// ─── Scenario 2: gh present, unauthenticated ────────────────────────────────

function scriptUnauthenticated(args: string[]): GhHealthRunResult {
  if (isVersionProbe(args)) return { ok: true, stdout: "gh version 2.50.0 (2026-01-01)" };
  if (isAuthStatusProbe(args)) return { ok: false, reason: "auth-required" };
  return { ok: false, reason: "error", message: "unexpected gh invocation after an auth-required result" };
}

// ─── Scenario 3: gh present + authenticated, target repo unreadable ────────

function scriptRepoUnreadable(args: string[]): GhHealthRunResult {
  if (isVersionProbe(args)) return { ok: true, stdout: "gh version 2.50.0 (2026-01-01)" };
  if (isAuthStatusProbe(args)) return { ok: true, stdout: "Logged in to github.com as octocat" };
  if (isRateLimitProbe(args)) return { ok: true, stdout: JSON.stringify({ resources: { core: { remaining: 5000 } } }) };
  if (isRepoReadProbe(args)) return { ok: false, reason: "error", message: "HTTP 404: Not Found (repository not accessible)" };
  return { ok: false, reason: "error", message: "unexpected gh invocation in the repo-unreadable scenario" };
}

// ─── Scenario 4: every precondition satisfied ───────────────────────────────

function scriptHealthy(args: string[]): GhHealthRunResult {
  if (isVersionProbe(args)) return { ok: true, stdout: "gh version 2.50.0 (2026-01-01)" };
  if (isAuthStatusProbe(args)) return { ok: true, stdout: "Logged in to github.com as octocat" };
  if (isRateLimitProbe(args)) return { ok: true, stdout: JSON.stringify({ resources: { core: { remaining: 5000 } } }) };
  if (isRepoReadProbe(args)) return { ok: true, stdout: JSON.stringify({ full_name: "acme/widgets" }) };
  return { ok: false, reason: "error", message: "unexpected gh invocation in the healthy scenario" };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("lore setup --check: GitHub channel health probe (RED — pre-implementation)", () => {
  it("NEGATIVE: gh absent from PATH -> reports the gh-missing condition, names cli.github.com, overall result is a failure", async () => {
    const { runner, calls, mutatingCalls } = createGuardedRunner(scriptGhMissing);

    const report: GhHealthCheckReport = await runGitHubHealthCheck({ runner });

    expect(report.ok).toBe(false);
    expect(report.condition).toBe("gh-missing");
    expect(report.remedy).toBe("cli.github.com");
    expect(report.message).toContain("cli.github.com");
    // not a vacuous pass — the probe must have actually asked the runner something
    expect(calls.length).toBeGreaterThan(0);
    // structural no-write guarantee holds even on the failure path
    expect(mutatingCalls).toEqual([]);
  });

  it("NEGATIVE: gh present but unauthenticated -> reports the auth condition and names 'gh auth login'", async () => {
    const { runner, calls, mutatingCalls } = createGuardedRunner(scriptUnauthenticated);

    const report: GhHealthCheckReport = await runGitHubHealthCheck({ runner });

    expect(report.ok).toBe(false);
    expect(report.condition).toBe("gh-unauthenticated");
    expect(report.remedy).toBe("gh auth login");
    expect(report.message).toContain("gh auth login");
    // must have genuinely reached the auth-status probe, not short-circuited before it
    expect(calls.some((c) => isAuthStatusProbe(c.args))).toBe(true);
    expect(mutatingCalls).toEqual([]);
  });

  it("BOUNDARY/NEGATIVE: gh present + authenticated but the target repo is unreadable -> distinguishable from the auth-required condition", async () => {
    const { runner, calls, mutatingCalls } = createGuardedRunner(scriptRepoUnreadable);

    const report: GhHealthCheckReport = await runGitHubHealthCheck({ runner });

    expect(report.ok).toBe(false);
    expect(report.condition).toBe("repo-unreadable");
    // the collapse this scenario exists to rule out:
    expect(report.condition).not.toBe("gh-unauthenticated");
    expect(report.remedy).not.toBe("gh auth login");
    // must have genuinely reached the repo-read probe (auth succeeded first)
    expect(calls.some((c) => isAuthStatusProbe(c.args))).toBe(true);
    expect(calls.some((c) => isRepoReadProbe(c.args))).toBe(true);
    expect(mutatingCalls).toEqual([]);
  });

  it("HAPPY/STATE: every precondition satisfied -> success, and zero writes of any kind", async () => {
    const { runner, calls, mutatingCalls } = createGuardedRunner(scriptHealthy);

    const report: GhHealthCheckReport = await runGitHubHealthCheck({ runner });

    expect(report.ok).toBe(true);
    expect(report.condition).toBe("healthy");
    expect(report.remedy).toBeUndefined();
    // guard against a stub that reports "healthy" without ever asking anything:
    // every mandatory precondition must have actually been probed.
    expect(calls.some((c) => isAuthStatusProbe(c.args))).toBe(true);
    expect(calls.some((c) => isRepoReadProbe(c.args))).toBe(true);
    // the scenario that carries the most weight: NOT ONE mutating verb was
    // ever invoked while reporting a healthy channel.
    expect(mutatingCalls).toEqual([]);
  });

  it("STATE (falsifier control): the mutating-verb guard used above actually detects a write — proving the no-write assertions are not vacuous", () => {
    expect(isMutatingGhInvocation(["issue", "create"])).toBe(true);
    expect(isMutatingGhInvocation(["repo", "create"])).toBe(true);
    expect(isMutatingGhInvocation(["api", "repos/acme/widgets/issues", "--method", "POST"])).toBe(true);
    expect(isMutatingGhInvocation(["api", "repos/acme/widgets/issues/1", "-X", "PATCH"])).toBe(true);
    expect(isMutatingGhInvocation(["api", "repos/acme/widgets/issues/1", "-X", "DELETE"])).toBe(true);

    // the four read-only probes this health check is built from must NEVER trip it
    expect(isMutatingGhInvocation(["--version"])).toBe(false);
    expect(isMutatingGhInvocation(["auth", "status"])).toBe(false);
    expect(isMutatingGhInvocation(["api", "rate_limit"])).toBe(false);
    expect(isMutatingGhInvocation(["api", "repos/acme/widgets"])).toBe(false);
  });
});
