/**
 * RED/TDD REGRESSION anchor for spec-plan-closure-must-be-loud-terminality-
 * divergence-silent §Design Decisions DD-4 — AC-CLOSURE-6.
 *
 * Live 2026-07-28 incident, reproduced end to end: a plan whose `parent_id` WAS
 * an approved tech spec declaring >= 1 script-mode acceptance criterion, closed
 * via `lore set <plan> --status archived` while its only task carried
 * self-reported-only evidence (zero runner-attested entries — `lore verify` was
 * never run), was DENIED on attestation grounds as expected, but the deny
 * message ALSO told the operator this plan "has no spec-tier ancestor at all" —
 * a provably false claim that would have sent the operator toward reparenting a
 * CORRECT corpus, or declaring a `pipeline-unreachable` exemption that doesn't
 * apply. Root cause: `CorpusService.set`'s plan-close `GateContext` never
 * populates `hasSpecParent`/`parentSpecScriptAcCount` even though
 * `getPlanBundle` has already resolved the ancestor spec for this exact branch
 * (DD-4(a)), and `verifyReachability` collapses "caller told me nothing" onto
 * the same definite claim as "caller resolved a genuinely non-spec parent"
 * (DD-4(b)).
 *
 * bun test (not vitest): spawns the real compiled `dist/lore` binary against a
 * THROWAWAY corpus (`mkdtemp` + `lore init`, cwd inside it) — mirrors
 * `cli-feed-task-start.bun.test.ts`'s harness, the closest in-repo template for
 * a full-binary subprocess CLI test. ⛔ Never touches the repo's own `.lore/`
 * corpus (project CLAUDE.md hard rule) — every test operates inside its own
 * `mkdtempSync` directory, and `dist/lore` runs with `cwd` and `HOME` both
 * pointed at it.
 *
 * `assertFreshBinary` fails loud if `dist/lore` is missing or older than the
 * newest `.ts` source under `packages/{lore,core}/src` — this suite spawns the
 * COMPILED binary directly, so a stale artifact would otherwise let the test
 * silently validate old logic against new source (`bun run build` first).
 *
 * Coverage dimension: REGRESSION (the live incident, reproduced verbatim —
 * this file's sole purpose is anchoring that exact shape; no other dimension
 * applies to a single-scenario regression anchor).
 *
 * @spec_ref spec-plan-closure-must-be-loud-terminality-divergence-silent
 *   §Design Decisions DD-4, §Acceptance Criteria AC-CLOSURE-6
 *
 * TG-25 (adr-tg-1 option b): the commands run IN-PROCESS through tests/helpers/run-lore-in-process.ts, not through
 * dist/lore. Wherever the prose above says the compiled binary is spawned or its freshness asserted, that is the
 * history of this file; the assertions and the throwaway-corpus rule are unchanged.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import yaml from "yaml";
import { citeSpecViaAsyncCli, asyncLoreRunnerFor } from "../helpers/cli-live-rule.js";
import { runLoreInProcess } from "../helpers/run-lore-in-process";

// ─── Types ──────────────────────────────────────────────────────────────────

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

// ─── Paths ──────────────────────────────────────────────────────────────────

// tests/integration/ -> packages/lore/ -> packages/ -> repo root (4 levels up).
const PROJECT_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Runs the compiled `dist/lore` binary directly (real e2e binary, not `bun run src/`). */
async function runLore(args: string[], cwd: string): Promise<RunResult> {
  const proc = await runLoreInProcess(args, {
    cwd,
    env: { ...process.env, HOME: cwd, LORE_ACTOR: "agent:plan-close-reachability-test" },
  });
  return {
    stdout: proc.stdout,
    stderr: proc.stderr,
    exitCode: proc.exitCode,
  };
}

async function initCorpus(dir: string): Promise<void> {
  const result = await runLore(["init"], dir);
  if (result.exitCode !== 0) {
    throw new Error(`lore init failed: ${result.stderr}`);
  }
}

function parseSlug(stdout: string): string {
  const match = stdout.match(/Slug:\s+(\S+)/);
  const slug = match?.[1];
  if (slug === undefined) {
    throw new Error(`could not parse slug from create output: ${stdout}`);
  }
  return slug;
}

/**
 * Merges a `workflow: {...}` YAML fragment into `.lore/config.yaml` (shallow
 * merge over the top-level `workflow` map) — mirrors
 * `cli-feed-task-start.bun.test.ts`'s helper of the same name/shape, used here
 * only to disable SPEC-103 M2's review-judgment checkpoint so the spec-approve
 * step below is reachable without an unrelated judgment fixture.
 */
function appendWorkflowConfig(dir: string, yamlFragment: string): void {
  const cfgPath = join(dir, ".lore", "config.yaml");
  const existing = yaml.parse(readFileSync(cfgPath, "utf8")) as Record<string, unknown>;
  const fragment = yaml.parse(yamlFragment) as { workflow?: Record<string, unknown> };
  const mergedWorkflow = {
    ...(existing["workflow"] as Record<string, unknown> | undefined),
    ...fragment.workflow,
  };
  writeFileSync(cfgPath, yaml.stringify({ ...existing, workflow: mergedWorkflow }), "utf8");
}

/**
 * Builds the exact live-incident shape: PRD -> approved tech spec declaring
 * one script-mode AC -> approved plan -> one task carrying self-reported-only
 * evidence (a `pass` recorded via plain `lore evidence`, never runner-attested
 * via `lore verify`).
 */
async function createFixtureChain(dir: string): Promise<{ planSlug: string }> {
  const prdResult = await runLore(
    ["create", "prd", "--title", "AC-CLOSURE-6 Regression PRD", "--content", "PRD body.", "--no-ai"],
    dir,
  );
  expect(prdResult.exitCode).toBe(0);
  const prdSlug = parseSlug(prdResult.stdout);

  const specResult = await runLore(
    [
      "create",
      "spec",
      "--title",
      "AC-CLOSURE-6 Regression Spec",
      "--kind",
      "tech",
      "--content",
      "## Overview\n\nRegression fixture spec for plan-close reachability (DD-4).\n",
      "--no-ai",
    ],
    dir,
  );
  expect(specResult.exitCode).toBe(0);
  const specSlug = parseSlug(specResult.stdout);

  const acResult = await runLore(
    [
      "ac",
      "add",
      specSlug,
      "AC-CLOSURE-6-1",
      "--statement",
      "The plan-close reachability regression is reproduced end to end.",
      "--mode",
      "script",
      "--oracle",
      "test",
      "--command",
      "bun test",
    ],
    dir,
  );
  expect(acResult.exitCode).toBe(0);

  // reason: SPEC-103 M2's review-judgment checkpoint defaults spec/adr into
  // `judgment_required_types` — disabled here (mirrors
  // cli-feed-task-start.bun.test.ts) since this suite exercises plan-close
  // reachability, not review-judgment.
  appendWorkflowConfig(dir, "\nworkflow:\n  review:\n    judgment_required_types: []\n");

  // reason: spec-declaring-ac-scope-is-required-at-task-creation-so-the — this
  // spec now declares a script-mode AC (AC-CLOSURE-6-1), so task-create's
  // admission gate would otherwise require the fixture task below to declare
  // ac_scope. Disabled rather than declared: this suite's subject is the
  // plan-close deny message's WORDING (per this file's header), which conjunct
  // produces the denial is deliberately irrelevant here — task-create is an
  // independent checkpoint from plan-close's own attestation-floor predicate
  // under test.
  appendWorkflowConfig(dir, '\nworkflow:\n  gates:\n    "task-create":\n      enabled: false\n');

  // reason: spec-declared-scope-attestation-contract-task-owned-ac-scope §Facts
  // D5 demoted the per-task zero-attested condition, so this fixture's
  // self-reported-only entry no longer denies the close by itself; the surviving
  // conjunct reachable from a pure-CLI fixture is the OPT-IN ratio, configured
  // here (1 entry, 0 attested => ratio 0 < 0.5). The denial this suite is about
  // is still an ATTESTATION_FLOOR_NOT_MET denial rendering the reachability
  // branch — which is what AC-CLOSURE-6 pins (its subject is the deny message's
  // WORDING, per this file's header, not which conjunct produced it).
  appendWorkflowConfig(dir, "\nworkflow:\n  attestation:\n    min_ratio: 0.5\n");

  await citeSpecViaAsyncCli(asyncLoreRunnerFor(runLore, dir), dir, undefined, specSlug, "AC-CLOSURE-6-1"); // BR-1007: approvable only when a criterion cites a live rule
  const approveSpecResult = await runLore(["approve", specSlug], dir);
  expect(approveSpecResult.exitCode).toBe(0);

  const planResult = await runLore(
    [
      "create",
      "plan",
      "--title",
      "AC-CLOSURE-6 Regression Plan",
      "--parent",
      specSlug,
      "--content",
      "## Plan\n\nRegression fixture plan.\n",
      "--no-ai",
    ],
    dir,
  );
  expect(planResult.exitCode).toBe(0);
  const planSlug = parseSlug(planResult.stdout);

  // draft -> approved is the fast-track edge (VALID_TRANSITIONS); the plan's
  // ancestor spec is already approved with a declared script-mode AC, so
  // plan-promote's own predicates are satisfied.
  const approvePlanResult = await runLore(["approve", planSlug], dir);
  expect(approvePlanResult.exitCode).toBe(0);

  const taskResult = await runLore(
    [
      "create",
      "task",
      "--title",
      "AC-CLOSURE-6 Regression Task",
      "--parent",
      planSlug,
      "--plan-id",
      planSlug,
      "--content",
      "Estimate: S\nApproach: reproduce the plan-close reachability regression.",
      "--no-ai",
    ],
    dir,
  );
  expect(taskResult.exitCode).toBe(0);
  const taskSlug = parseSlug(taskResult.stdout);

  // Self-reported-only evidence — a plain `lore evidence` call, never run
  // through `lore verify`, so this entry carries zero runner attestation.
  // reason: SUPERSEDED oracle (task-raise-the-evidence-tail-guard-s-predicate-
  // to-its-own) — "test" self-report is now refused regardless of tail
  // content; "manual" is the one oracle that still lets a genuinely
  // non-empty self-reported tail succeed while staying UNATTESTED (this
  // fixture's own point — zero runner attestation for the attestation-gate
  // regression it exercises).
  const evidenceResult = await runLore(
    ["evidence", taskSlug, "--oracle", "manual", "--command", "bun test", "--result", "pass", "--output-tail", "ok"],
    dir,
  );
  expect(evidenceResult.exitCode).toBe(0);

  return { planSlug };
}

// ─── Project-level state ──────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "lore-plan-close-reachability-test-"));
  await initCorpus(tmpDir);
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

// ─── REGRESSION — the live 2026-07-28 incident, reproduced end to end ──────

describe("REGRESSION — plan parented to an approved tech spec with >=1 script-mode AC (AC-CLOSURE-6)", () => {
  it("denies `lore set <plan> --status archived` on attestation grounds and NEVER claims 'no spec-tier ancestor'", async () => {
    const { planSlug } = await createFixtureChain(tmpDir);

    const archiveResult = await runLore(["set", planSlug, "--status", "archived"], tmpDir);

    // DENIES — the plan's only task carries self-reported-only evidence, so
    // the attestation floor (SPEC-069) is genuinely unmet. This is the
    // CORRECT, expected denial — the regression is about its WORDING, not
    // about whether it denies at all.
    expect(archiveResult.exitCode).not.toBe(0);
    expect(archiveResult.stderr).toContain("ATTESTATION_FLOOR_NOT_MET");

    // The live incident's exact defect: plan-close's GateContext never
    // populated hasSpecParent/parentSpecScriptAcCount for this plan, even
    // though its parent IS an approved tech spec declaring a script-mode AC —
    // so the deny pack asserted a claim it was never in a position to make.
    expect(archiveResult.stderr).not.toContain("no spec-tier ancestor");
  });
});
