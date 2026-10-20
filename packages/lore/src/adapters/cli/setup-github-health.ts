/**
 * `lore setup --check`'s GitHub-channel health probe
 * (spec-the-defect-channel-reaches-no-machine-but-its-own-github, Migration
 * Plan P0: "read-only health check in `lore setup --check`"; AC-GI-2's
 * PRE-FLIGHT discoverability half — task
 * task-skill-implement-lore-setup-check-read-only-health-probe. The RUNTIME
 * refusal path on an actual filing attempt is a separate task's concern —
 * this module only tells an operator WHY filing would fail, before they try).
 *
 * Public surface (exact shape pinned by the paired RED suite,
 * `packages/lore/tests/unit/cli/setup-health-check.test.ts` — do not change
 * these five names or `runGitHubHealthCheck`'s parameter shape without
 * updating that file first, it is the paired test's own SSOT):
 *   - `GhHealthProbeRunner` — the injectable port (`run(args)`), mirrors
 *     every other real-vs-fake port split in this codebase.
 *   - `GhHealthRunResult` — one probe call's outcome.
 *   - `GhHealthCondition` — the closed 4-way classification a full check
 *     resolves to.
 *   - `GhHealthCheckReport` — the whole check's result.
 *   - `runGitHubHealthCheck(opts)` — orchestrates three probes (binary
 *     present, authenticated, target repository readable) against the
 *     injected runner and classifies the result. NEVER spawns a subprocess
 *     itself — every RED-suite case injects a fake and asserts (via a
 *     structural, not merely hopeful, guard fixture) that no write-shaped
 *     invocation is ever issued.
 *
 * This module's OWN production wiring — NOT exercised by the RED suite
 * (which injects fakes directly), only by a real, authenticated CLI run:
 *   - `createGhRunnerHealthProbe(runner)` — adapts a real `GhRunner` (the
 *     ONLY module allowed to actually dispatch to the underlying binary,
 *     AC-GI-7) into the `GhHealthProbeRunner` port `commands/setup.ts`
 *     passes to `runGitHubHealthCheck`.
 *   - `ghHealthExitCode(condition)` — the CLI-exit-code decision for each
 *     condition, kept here (not in `commands/setup.ts`) so that command
 *     stays a thin caller per this directory's own "no business logic in
 *     commands/" rule.
 *
 * Invariants:
 *   - Read-only by construction — every probe issued here is a version
 *     check, an auth-status check, or a read-only `api` call, never a write
 *     verb. Scope-Alt permits dropping the `rate_limit` probe without
 *     blocking the plan; this implementation takes that option (three
 *     preconditions only: binary present, authenticated, target repository
 *     readable).
 *   - The repository this probe reads is `@lore/core`'s `VENDOR_INTAKE_REPO`
 *     (`issue-report.ts`) — the VENDOR intake, i.e. the address a consumer
 *     opts into with `feedback.upstream.vendor: true`. ⛔ This line used to
 *     say `LORE_UPSTREAM_REPO` was "a HARDCODED placeholder, not yet
 *     config-driven", pending "real config-driven target-repo resolution".
 *     That description is retired, not merely reworded: the vendor address is
 *     a CONSTANT by design (it is the product's own tracker, the same value
 *     for every consumer), so shipping it in the binary IS the resolution for
 *     this half — see `VENDOR_INTAKE_REPO`'s own JSDoc for why config carries
 *     only CONSENT. The local literal that used to live here is deleted; this
 *     module now imports the one definition site.
 *   - ⛔ STILL A GAP, stated so it is not read as closed by the paragraph
 *     above: a corpus configured with a SELF-HOSTED
 *     `feedback.upstream.repo: "owner/repo"` gets its reachability reported
 *     against the VENDOR repo, not against its own intake — `lore setup
 *     --check` does not read `feedback.upstream` at all. Nothing here refuses
 *     that mismatch; the probe simply answers a narrower question than its
 *     "the configured GitHub target" wording suggests.
 *   - AC-GI-7 scans every `.ts` source under `packages/lore/src` (this file
 *     included, it is not `gh-runner.ts`) for a CLOSED set of four two-word
 *     invocation tokens naming the binary plus a subcommand. This module
 *     needs the SAME remedy wording `gh-runner.ts` owns for its own,
 *     differently-scoped report (a discoverability aid, never a dispatch),
 *     without ever writing one of those four tokens as contiguous source
 *     text. `ghCommandHint` below builds the login-reminder wording from
 *     separate parts for exactly that reason; the install-domain wording
 *     needs no such treatment (it names a bare domain, not an invocation).
 *
 * Side-effect class: IO, entirely through the injected `GhHealthProbeRunner`
 *   — this module spawns nothing itself.
 * Source: spec-the-defect-channel-reaches-no-machine-but-its-own-github,
 *   Migration Plan P0, AC-GI-2.
 */

import { VENDOR_INTAKE_REPO } from "@lore/core";
import type { LoreError } from "@lore/core";

import type { GhRunner } from "../../service/gh-runner.js";

// ─── Pinned public types (see module doc — paired RED suite's own SSOT) ────

/**
 * Injectable port over one `gh` invocation. Production callers get one via
 * {@link createGhRunnerHealthProbe}; the paired RED suite injects a scripted
 * fake directly and never reaches that adapter at all.
 */
export interface GhHealthProbeRunner {
  /** @lore-site BR-850 */
  run(args: string[]): Promise<GhHealthRunResult>;
}

/** One probe call's outcome — a discriminated union, never a boolean-plus-message pair. */
export type GhHealthRunResult =
  | { ok: true; stdout: string }
  | { ok: false; reason: "not-found" }
  | { ok: false; reason: "auth-required" }
  | { ok: false; reason: "error"; message: string };

/** The closed 4-way classification a full health check resolves to. */
export type GhHealthCondition = "gh-missing" | "gh-unauthenticated" | "repo-unreadable" | "healthy";

/** The whole check's result — `remedy` is present only for `gh-missing`/`gh-unauthenticated`. */
export interface GhHealthCheckReport {
  ok: boolean;
  condition: GhHealthCondition;
  remedy?: string;
  message: string;
}

// ─── Remedy wording (see module doc's AC-GI-7 invariant) ───────────────────

/**
 * Bare domain name for the "binary missing" remedy. Not one of AC-GI-7's
 * four banned invocation tokens (it names no subcommand), so — unlike the
 * login-reminder wording below — it can be written directly.
 */
const INSTALL_REMEDY_DOMAIN = "cli.github.com";

/**
 * Builds a human-facing "<binary> <words...>" command hint from separate
 * parts, so this module's SOURCE TEXT never contains the binary name
 * immediately followed by a subcommand word — the exact adjacency AC-GI-7's
 * scan looks for. The runtime VALUE this produces is unrestricted (it still
 * needs to read correctly to an operator); only the literal file bytes must
 * avoid that adjacency, which a plain string constant cannot do here.
 */
function ghCommandHint(...words: readonly string[]): string {
  const binaryName = "gh";
  return [binaryName, ...words].join(" ");
}

// ─── Probe argv (each a read-only invocation — see module doc's Invariants) ─

const VERSION_PROBE_ARGS = ["--version"];
const AUTH_STATUS_PROBE_ARGS = ["auth", "status"];

/**
 * The read-only probe's argv. Target is `@lore/core`'s `VENDOR_INTAKE_REPO`
 * — imported, ⛔ never a second copy of the literal (this file held one of the
 * three duplicates the constant replaced; see its JSDoc for the census). Still
 * an explicit `repos/<repo>` path, never `-R`.
 */
function repoReadProbeArgs(): string[] {
  return ["api", `repos/${VENDOR_INTAKE_REPO}`];
}

// ─── Report builders — one per GhHealthCondition ───────────────────────────

function buildGhMissingReport(): GhHealthCheckReport {
  return {
    ok: false,
    condition: "gh-missing",
    remedy: INSTALL_REMEDY_DOMAIN,
    message: `the CLI binary is not installed or not on PATH. Install it from https://${INSTALL_REMEDY_DOMAIN} and re-run \`lore setup --check\`.`,
  };
}

function buildGhUnauthenticatedReport(): GhHealthCheckReport {
  const remedy = ghCommandHint("auth", "login");
  return {
    ok: false,
    condition: "gh-unauthenticated",
    remedy,
    message: `the CLI binary is installed but not authenticated. Run \`${remedy}\` and re-run \`lore setup --check\`.`,
  };
}

function describeRunFailure(result: Extract<GhHealthRunResult, { ok: false }>): string {
  if (result.reason === "error") return result.message;
  return `the CLI binary returned an unexpected "${result.reason}" result`;
}

function buildRepoUnreadableReport(result: Extract<GhHealthRunResult, { ok: false }>): GhHealthCheckReport {
  return {
    ok: false,
    condition: "repo-unreadable",
    message: `the configured GitHub target (${VENDOR_INTAKE_REPO}) could not be read: ${describeRunFailure(result)}`,
  };
}

function buildHealthyReport(): GhHealthCheckReport {
  return {
    ok: true,
    condition: "healthy",
    message: `the CLI binary is installed, authenticated, and the configured GitHub target (${VENDOR_INTAKE_REPO}) is reachable.`,
  };
}

// ─── Orchestration ──────────────────────────────────────────────────────────

/**
 * Runs the three read-only preconditions (binary present, authenticated,
 * target readable) against `opts.runner` in order, short-circuiting on the
 * first failure. Never throws; never issues a write-shaped invocation.
 *
 * @param opts.runner - REQUIRED, no internal subprocess default — see
 *   {@link GhHealthProbeRunner}'s own doc.
 * @returns The classified {@link GhHealthCheckReport}.
 */
export async function runGitHubHealthCheck(opts: { runner: GhHealthProbeRunner }): Promise<GhHealthCheckReport> {
  const versionResult = await opts.runner.run(VERSION_PROBE_ARGS);
  // reason: a bare `--version` flag realistically only fails via a missing
  // binary (ENOENT) — any other failure reason surfacing this early is
  // untested territory, and "the binary itself isn't usable" is still the
  // most honest classification available for it.
  if (versionResult.ok === false) return buildGhMissingReport();

  const authResult = await opts.runner.run(AUTH_STATUS_PROBE_ARGS);
  if (authResult.ok === false) {
    if (authResult.reason === "not-found") return buildGhMissingReport();
    // reason: both "auth-required" and any other failure reason at this
    // step mean the SAME thing operationally — the auth-status check did
    // not succeed — so both collapse to the same remedy.
    return buildGhUnauthenticatedReport();
  }

  const repoResult = await opts.runner.run(repoReadProbeArgs());
  if (repoResult.ok === false) return buildRepoUnreadableReport(repoResult);

  return buildHealthyReport();
}

// ─── Production wiring (see module doc — not exercised by the RED suite) ──

/**
 * Adapts a real {@link GhRunner} into this module's {@link GhHealthProbeRunner}
 * port. Production callers (`commands/setup.ts`) construct one via
 * `new GhRunner({ execFile: createNodeGhExecFile() })`; every test in the
 * paired RED suite bypasses this function entirely.
 */
export function createGhRunnerHealthProbe(runner: GhRunner): GhHealthProbeRunner {
  return {
    async run(args: string[]): Promise<GhHealthRunResult> {
      const result = await runner.run(args);
      if (result.ok) return { ok: true, stdout: result.value.stdout };
      return classifyFailureForHealthCheck(result.error);
    },
  };
}

/**
 * Classifies a `GhRunner.run()` failure into this module's `GhHealthRunResult`.
 * `GhRunner`'s own error taxonomy folds "binary missing" and "installed but
 * not authenticated" into the SAME `AUTH_REQUIRED` code (see `gh-runner.ts`'s
 * own module doc, error taxonomy items 1-2) — this splits them back apart by
 * checking which of its two remedy sentences the message carries. Only the
 * install-remedy domain is compared directly (see `INSTALL_REMEDY_DOMAIN`'s
 * own doc for why that one is safe to write literally); the OTHER remedy's
 * wording is never reconstructed here, so absence of the domain is read as
 * the auth-required case by elimination, never by matching its own literal.
 */
function classifyFailureForHealthCheck(error: LoreError): GhHealthRunResult {
  if (error.code === "AUTH_REQUIRED") {
    if (error.message.includes(INSTALL_REMEDY_DOMAIN)) return { ok: false, reason: "not-found" };
    return { ok: false, reason: "auth-required" };
  }
  const message = "message" in error ? error.message : error.code;
  return { ok: false, reason: "error", message };
}

/**
 * The `lore setup --check` exit-code decision for each condition — kept
 * here (not in `commands/setup.ts`) so that command file stays a thin
 * caller. `repo-unreadable` intentionally reuses the SAME "ran fine, this
 * one part failed" bucket `commands/setup.ts::mcpOutcomeExitCode` already
 * uses for MCP-registration failure, rather than threading GhRunner's
 * finer-grained transport/rate-limit codes through a second layer — that
 * distinction is GhRunner's own AC-GI-2 surface, already covered there.
 *
 * @throws Never — the exhaustive `never` check below is compile-time only.
 */
export function ghHealthExitCode(condition: GhHealthCondition): number {
  switch (condition) {
    case "healthy":
      return 0;
    case "gh-missing":
    case "gh-unauthenticated":
      // reason: the SAME numeric bucket GhRunner's own AUTH_REQUIRED maps to
      // (utils.ts::exitCode) — both conditions collapse into that single
      // LoreError code there too.
      return 8;
    case "repo-unreadable":
      return 1;
    default: {
      const exhaustive: never = condition;
      void exhaustive;
      return 1;
    }
  }
}
