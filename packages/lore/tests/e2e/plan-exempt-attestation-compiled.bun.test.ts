// @spawns packages/lore/tests/helpers/approve-nodes-cli.ts
// @reads assets/project/lore-config-template.yaml
// @reads assets/governance/write-spec-rule.md
/**
 * plan-exempt-attestation-compiled.bun.test.ts — SPEC-069 AC-069-13: THE PAIR.
 *
 * The author→trip end-to-end oracle the project requires for every gate-read
 * field. `extra.attestation_exempt` was gate-read with NO writer for a week;
 * the unit suite proves the writer merges correctly, but only a real binary
 * driving a real corpus can prove the thing that actually matters: that the
 * exemption is what CHANGES THE VERDICT, and that a close it enabled is never
 * silent about it.
 *
 * The pair, on ONE plan in ONE corpus so the exemption is the only variable:
 *   1. CONTROL — close the plan: DENIED (`ATTESTATION_FLOOR_NOT_MET`).
 *   2. Declare the exemption with `lore plan exempt-attestation`.
 *   3. TREATMENT — close the same plan again: SUCCEEDS, and the output NAMES
 *      the exemption, its typed kind, and its reason.
 * Plus a SECOND, independent corpus built by the identical fixture that is
 * NEVER exempted and is retried the same number of times — without it, "the
 * second close succeeded" is confounded with "it was the second attempt".
 *
 * bun test (not vitest): spawns the real compiled `dist/lore` against a
 * THROWAWAY corpus (`mkdtemp` + `lore init`, cwd AND `HOME` inside it).
 * ⛔ Never touches the repo's own `.lore/` (project CLAUDE.md hard rule).
 *
 * `assertFreshBinary` fails loud when `dist/lore` is missing or older than the
 * newest `.ts` under `packages/{lore,core}/src` — the fourth false-oracle
 * vector (a stale artifact silently validating old logic against new source).
 *
 * Coverage: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION
 *
 * @spec_ref AC-069-13 (the pair + naming), AC-069-9 (refusal exit codes
 *   observed from a REAL process), AC-069-11 (no `lore set` back door,
 *   observed as a real exit code) — SPEC-069 §Design Decisions D1
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
import { patchLoreConfig } from "../helpers/patch-lore-config.js";
import { citeSpecViaAsyncCli, asyncLoreRunnerFor } from "../helpers/cli-live-rule.js";
import { runLoreInProcess } from "../helpers/run-lore-in-process";

// ─── Types ──────────────────────────────────────────────────────────────────

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

// ─── Paths ──────────────────────────────────────────────────────────────────

// tests/e2e/ -> packages/lore/ -> packages/ -> repo root (4 levels up).
const PROJECT_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");

const EXEMPT_REASON = "every task here is a RED/TDD anchor; attesting would misrepresent it";
const EXEMPT_KIND = "red-tdd";

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function runLore(args: string[], cwd: string): Promise<RunResult> {
  const proc = await runLoreInProcess(args, {
    cwd,
    home: cwd,
    env: { ...process.env, HOME: cwd, CLAUDE_CODE_SESSION_ID: "a77e57e1-aaaa-bbbb-cccc-111111111111" },
  });
  return {
    stdout: proc.stdout,
    stderr: proc.stderr,
    exitCode: proc.exitCode,
  };
}

async function initCorpus(dir: string): Promise<void> {
  const result = await runLore(["init"], dir);
  if (result.exitCode !== 0) throw new Error(`lore init failed: ${result.stderr}`);
}

function parseSlug(stdout: string): string {
  const slug = stdout.match(/Slug:\s+(\S+)/)?.[1];
  if (slug === undefined) throw new Error(`could not parse slug from: ${stdout}`);
  return slug;
}

/** Shallow-merges a `workflow:` YAML fragment into `.lore/config.yaml`. */
function appendWorkflowConfig(dir: string, fragmentYaml: string): void {
  patchLoreConfig(dir, fragmentYaml);
}

/** Reads a doc's `extra` through the real binary's JSON surface. */
async function getExtra(slug: string, dir: string): Promise<Record<string, unknown>> {
  const result = await runLore(["get", slug, "--json"], dir);
  expect(result.exitCode).toBe(0);
  const payload = JSON.parse(result.stdout) as { data: { doc: { extra: Record<string, unknown> } } };
  return payload.data.doc.extra;
}

/**
 * Builds a plan the attestation floor GENUINELY denies: an approved tech spec
 * declaring one script-mode AC, an approved plan under it carrying a phase (so
 * the read-merge-write has a sibling `extra` key to preserve), and one task
 * whose only evidence is self-reported (recorded via plain `lore evidence`,
 * never through `lore verify`, so zero runner attestation) — ratio 0 < 0.5.
 *
 * Walks the plan to `active` so the later `archived` transition is a legal
 * `VALID_TRANSITIONS` edge and the denial can only be the gate's doing.
 */
async function createDeniedPlan(dir: string): Promise<{ planSlug: string }> {
  const prd = await runLore(
    ["create", "prd", "--title", "AC-069-13 Exemption PRD", "--content", "PRD body.", "--no-ai"],
    dir,
  );
  expect(prd.exitCode).toBe(0);

  const spec = await runLore(
    [
      "create", "spec",
      "--title", "AC-069-13 Exemption Spec",
      "--kind", "tech",
      "--content", "## Overview\n\nFixture spec for the attestation-exemption pair.\n",
      "--no-ai",
    ],
    dir,
  );
  expect(spec.exitCode).toBe(0);
  const specSlug = parseSlug(spec.stdout);

  const ac = await runLore(
    [
      "ac", "add", specSlug, "AC-069-13-1",
      "--statement", "The attestation exemption is what changes the plan-close verdict.",
      "--mode", "script", "--oracle", "test", "--command", "bun test",
    ],
    dir,
  );
  expect(ac.exitCode).toBe(0);

  // SPEC-103 M2's review-judgment checkpoint defaults spec/adr into
  // `judgment_required_types`; disabled so the spec-approve step is reachable
  // without an unrelated judgment fixture. min_ratio pins the conjunct that
  // produces the denial (1 evidence entry, 0 attested => ratio 0 < 0.5).
  appendWorkflowConfig(dir, "\nworkflow:\n  review:\n    judgment_required_types: []\n");
  appendWorkflowConfig(dir, "\nworkflow:\n  attestation:\n    min_ratio: 0.5\n");

  await citeSpecViaAsyncCli(asyncLoreRunnerFor(runLore, dir), dir, undefined, specSlug, "AC-069-13-1"); // BR-1007: approvable only when a criterion cites a live rule
  expect((await runLore(["approve", specSlug], dir)).exitCode).toBe(0);

  const plan = await runLore(
    [
      "create", "plan",
      "--title", "AC-069-13 Exemption Plan",
      "--parent", specSlug,
      "--content", "## Plan\n\nFixture plan.\n",
      "--no-ai",
    ],
    dir,
  );
  expect(plan.exitCode).toBe(0);
  const planSlug = parseSlug(plan.stdout);

  // A sibling `extra` key the exemption write must preserve byte-identically.
  expect((await runLore(["phase", "add", planSlug, "Phase One"], dir)).exitCode).toBe(0);
  expect((await runLore(["approve", planSlug], dir)).exitCode).toBe(0);
  expect((await runLore(["set", planSlug, "--status", "active"], dir)).exitCode).toBe(0);

  const task = await runLore(
    [
      "create", "task",
      "--title", "AC-069-13 Exemption Task",
      "--parent", planSlug,
      "--plan-id", planSlug,
      "--content", "Estimate: S\nApproach: fixture task.",
      "--no-ai",
      // reason: spec-declaring-ac-scope-is-required-at-task-creation-so-the —
      // this plan's spec declares a script-mode AC (AC-069-13-1), so
      // task-create's admission gate now requires ac_scope to be declared.
      // Explicit EMPTY (never the AC's own id) — the fixture's evidence below
      // is deliberately SELF-REPORTED with no --ac, so this task must not
      // newly participate in AC-069-13-1's declared-scope coverage
      // computation; an explicit "claims nothing" preserves the pre-existing
      // ratio-conjunct-only denial this test's assertions pin.
      "--ac-scope", "",
    ],
    dir,
  );
  expect(task.exitCode).toBe(0);

  // Self-reported-only evidence — never runner-attested.
  // reason: SUPERSEDED oracle (task-raise-the-evidence-tail-guard-s-
  // predicate-to-its-own) — "test" self-report is now refused regardless of
  // tail content; "manual" is the one oracle that still lets a genuinely
  // non-empty self-reported tail succeed while staying UNATTESTED (this
  // fixture's own point, per the comment above).
  expect(
    (await runLore(
      ["evidence", parseSlug(task.stdout), "--oracle", "manual", "--command", "bun test", "--result", "pass", "--output-tail", "ok"],
      dir,
    )).exitCode,
  ).toBe(0);

  return { planSlug };
}

// ─── Project-level state ─────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "lore-plan-exempt-attestation-"));
  await initCorpus(tmpDir);
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

// ═══ AC-069-13 — THE PAIR ═══════════════════════════════════════════════════

describe("AC-069-13 — the exemption is what changes the plan-close verdict", () => {
  it("AC-069-13 the SAME plan is denied without the exemption and closes with it, and the close NAMES it", async () => {
    const { planSlug } = await createDeniedPlan(tmpDir);

    // ── 1. CONTROL: the floor genuinely denies this plan ──────────────────
    const denied = await runLore(["set", planSlug, "--status", "archived"], tmpDir);
    expect(denied.exitCode).not.toBe(0);
    expect(denied.stderr).toContain("ATTESTATION_FLOOR_NOT_MET");
    // Still not archived — the gate refused before the write.
    expect((await runLore(["get", planSlug, "--json"], tmpDir)).stdout).not.toContain('"status": "archived"');

    // The denial must ALSO advertise the verb that resolves it — guidance with
    // no command behind it is the defect SPEC-069 closes.
    expect(denied.stderr).toContain("lore plan exempt-attestation");

    // ── 2. Declare the exemption with the dedicated writer ────────────────
    const exempt = await runLore(
      ["plan", "exempt-attestation", planSlug, "--reason", EXEMPT_REASON, "--kind", EXEMPT_KIND],
      tmpDir,
    );
    expect(exempt.exitCode).toBe(0);

    // All three fields authored; the sibling `phases` key survived the merge.
    const extra = await getExtra(planSlug, tmpDir);
    expect(extra["attestation_exempt"]).toBe(true);
    expect(extra["attestation_exempt_reason"]).toBe(EXEMPT_REASON);
    expect(extra["attestation_exempt_kind"]).toBe(EXEMPT_KIND);
    expect(Array.isArray(extra["phases"])).toBe(true);
    expect(JSON.stringify(extra["phases"])).toContain("Phase One");

    // ── 3. TREATMENT: the identical plan now closes ───────────────────────
    const closed = await runLore(["set", planSlug, "--status", "archived"], tmpDir);
    expect(closed.exitCode).toBe(0);
    expect(closed.stderr).not.toContain("ATTESTATION_FLOOR_NOT_MET");

    // …and the close is NOT silent about why it was allowed.
    const closeOutput = closed.stdout + closed.stderr;
    expect(closeOutput).toContain("ATTESTATION EXEMPTION");
    expect(closeOutput).toContain(EXEMPT_KIND);
    expect(closeOutput).toContain(EXEMPT_REASON);
  });

  /**
   * The confound control. Above, the successful close was the SECOND close
   * attempt on that plan. Here an identically-built plan is never exempted and
   * is closed twice — if a second attempt were what unblocked the close, this
   * would pass too. It must stay denied.
   */
  it("AC-069-13 CONTROL: an identical plan with NO exemption stays denied on the second attempt too", async () => {
    const { planSlug } = await createDeniedPlan(tmpDir);

    const first = await runLore(["set", planSlug, "--status", "archived"], tmpDir);
    expect(first.exitCode).not.toBe(0);
    expect(first.stderr).toContain("ATTESTATION_FLOOR_NOT_MET");

    const second = await runLore(["set", planSlug, "--status", "archived"], tmpDir);
    expect(second.exitCode).not.toBe(0);
    expect(second.stderr).toContain("ATTESTATION_FLOOR_NOT_MET");

    // And no exemption fields materialised on their own.
    const extra = await getExtra(planSlug, tmpDir);
    expect(extra["attestation_exempt"]).toBeUndefined();
  });

  /**
   * The gate does not honour a reason-less or off-taxonomy exemption, so the
   * writer must never be able to author one. Both halves are refused BEFORE any
   * write — proven here against a real process, not just the pure classifier.
   */
  it("AC-069-13 a half-declared exemption can never reach the corpus (a bare flag would be a lie)", async () => {
    const { planSlug } = await createDeniedPlan(tmpDir);

    const blankReason = await runLore(
      ["plan", "exempt-attestation", planSlug, "--reason", "   ", "--kind", EXEMPT_KIND],
      tmpDir,
    );
    expect(blankReason.exitCode).toBe(2);

    const badKind = await runLore(
      ["plan", "exempt-attestation", planSlug, "--reason", EXEMPT_REASON, "--kind", "bogus-kind"],
      tmpDir,
    );
    expect(badKind.exitCode).toBe(2);
    expect(badKind.stderr).toContain("red-tdd");
    expect(badKind.stderr).toContain("pipeline-unreachable");

    const missingKind = await runLore(
      ["plan", "exempt-attestation", planSlug, "--reason", EXEMPT_REASON],
      tmpDir,
    );
    expect(missingKind.exitCode).toBe(2);

    // Nothing was written by any of the three, and the plan is still denied.
    expect((await getExtra(planSlug, tmpDir))["attestation_exempt"]).toBeUndefined();
    expect((await runLore(["set", planSlug, "--status", "archived"], tmpDir)).exitCode).not.toBe(0);
  });

  it("AC-069-11 NO BACK DOOR: `lore set <plan> --attestation-exempt` exits 2 as an unknown flag", async () => {
    const { planSlug } = await createDeniedPlan(tmpDir);

    const backDoor = await runLore(["set", planSlug, "--attestation-exempt"], tmpDir);
    expect(backDoor.exitCode).toBe(2);

    const backDoorValued = await runLore(["set", planSlug, "--attestation-exempt", "true"], tmpDir);
    expect(backDoorValued.exitCode).toBe(2);

    // CONTROL: `set` is not refusing everything — a declared flag still works.
    expect((await runLore(["set", planSlug, "--priority", "high"], tmpDir)).exitCode).toBe(0);

    expect((await getExtra(planSlug, tmpDir))["attestation_exempt"]).toBeUndefined();
  });

  /**
   * AC-069-10's end-to-end half: the audit trail must answer "who exempted this
   * plan, and why" from the REAL binary with a REAL actor, not just from the
   * service under a hand-passed `by`.
   */
  it("AC-069-10 the exemption lands in the audit trail with the resolved actor and the reason", async () => {
    const { planSlug } = await createDeniedPlan(tmpDir);
    expect(
      (await runLore(
        ["plan", "exempt-attestation", planSlug, "--reason", EXEMPT_REASON, "--kind", EXEMPT_KIND],
        tmpDir,
      )).exitCode,
    ).toBe(0);

    const audit = await runLore(["audit", "--json"], tmpDir);
    expect(audit.exitCode).toBe(0);
    expect(audit.stdout).toContain("exempt-attestation");
    expect(audit.stdout).toContain("agent:session-a77e57e1");
    expect(audit.stdout).toContain(EXEMPT_REASON);
  });

  it("AC-069-13 the assessment-freshness sibling verb is reachable from the same group", async () => {
    const { planSlug } = await createDeniedPlan(tmpDir);

    const result = await runLore(
      ["plan", "exempt-assessment-freshness", planSlug, "--reason", "judged outcome is stale by design"],
      tmpDir,
    );
    expect(result.exitCode).toBe(0);

    const extra = await getExtra(planSlug, tmpDir);
    expect(extra["assessment_freshness_exempt"]).toBe(true);
    expect(extra["assessment_freshness_exempt_reason"]).toBe("judged outcome is stale by design");
    // The attestation fields were NOT written by the freshness verb.
    expect(extra["attestation_exempt"]).toBeUndefined();
  });
});
