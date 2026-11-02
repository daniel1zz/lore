// @spawns packages/lore/tests/helpers/approve-nodes-cli.ts
// @reads assets/project/lore-config-template.yaml
/**
 * Compiled-binary e2e suite proving
 * spec-plan-close-predicates-measure-invariants-an-applicability end-to-end,
 * from a consumer's position — a throwaway `mkdtemp` corpus driven entirely
 * through the COMPILED `dist/lore` binary, never source and never this repo's
 * own `.lore/` (project CLAUDE.md hard rule; 2026-07-07 pollution incident).
 *
 * task-t5-compiled-binary-e2e-from-a-throwaway-corpus-clean-close is the FINAL
 * task of its plan (T1-T4/T7/T8 already landed and unit-tested every
 * individual mechanism piece: the `PredicateNotApplicable` type, the
 * per-claimed-AC coverage conjunct, domain-doc attribution, the predicate
 * contract table, and the `lore approve` advisory render). This file's job is
 * NOT to re-prove those pieces in isolation — it proves the COMPOSITION holds
 * once every piece is assembled and driven through the actual compiled
 * artifact a consumer installs: a plan closes clean with the not-applicable
 * advisory genuinely visible (never a silent vacuous pass, §D2), and a
 * sibling plan's unattested claimed AC genuinely blocks the SAME command for
 * the RIGHT reason (proved via a control run, not merely a passing assertion).
 *
 * UPDATED for slice 3a (BR-984/BR-985): the domain-doc predicate and its plan-promote advisory are retired,
 * so scenario A now asserts that `lore approve` prints NO prd-sync advisory (the spec still has no domain
 * doc — the fixture shape below is unchanged — and that no longer matters), and the close stays clean with
 * the knob ON because the spec cites no baseline rule.
 *
 * Fixture shape (one PRD -> one spec -> two sibling plans):
 *   - The spec is parented DIRECTLY under the root PRD and declares zero
 *     `implements` edges, so `resolvePrdSyncDomainDoc` returns `ok(null)` — a
 *     FACT, never an error (`prd-sync-domain-doc.ts`) — the exact shape §D6's
 *     ADR-correction paragraph names (a mechanism-fix plan whose ancestor spec
 *     has no domain-level narrative to sync).
 *   - The spec declares ONE script-mode AC (`oracle: "other"`, command
 *     `"true"` — genuinely trivially green, never referencing a real test
 *     file, so neither the SPEC-061 attestation-completeness guard NOR the
 *     `lore evidence` missing-oracle-file precheck engage; both are scoped to
 *     `oracle: "test"`/`"e2e"` only).
 *   - Plan A's task records evidence for that AC via `lore verify` (the
 *     trusted-runner path, SPEC-039) — the ONLY legitimate way to produce a
 *     runner-`attestation`-bearing entry; this suite never hand-crafts one.
 *   - Plan B (sibling, same governing spec) claims the SAME AC id with only a
 *     self-reported `lore evidence` entry.
 *
 * Config: `workflow.gates."plan-close".cited_rule_check.enabled: true`, NO
 * `workflow.attestation.min_ratio` declared at all (§D4's "absent -> null ->
 * the ratio conjunct never runs" default) — scenario B's control REWRITES the
 * config mid-suite to add an explicit floor, after scenario A has run —,
 * `workflow.review
 * .judgment_required_types: []` (neutralizes the UNRELATED SPEC-103 review-
 * judgment gate for this suite's spec/adr approvals — `approve-advisory-
 * render.test.ts`'s own precedent for isolating that gate from a fixture that
 * isn't testing it).
 *
 * Coverage (one test per named scenario, both containing the task's pinned
 * `-t 'compiled close'` filter string via this file's shared describe title):
 *   "scenario A" — the attested single-claimed-AC plan archives at exit 0,
 *     with the not-applicable advisory genuinely printed (to `lore approve`'s
 *     stderr, per D2's "loud on two channels" — the close-time audit row is
 *     the auditor's channel; the plan-promote advisory is the operator's, and
 *     the one this suite can observe from the CLI surface).
 *   "scenario B" — REWRITTEN by spec-declared-scope-attestation-contract-task-
 *     owned-ac-scope §Facts D4/D5. It used to pin "an unattested EXERCISED
 *     (`claimed`) AC blocks at exit 4"; D4 retired that conjunct (the audited
 *     evidence was defining its own audit scope) in favour of the DECLARED scope
 *     (`task.extra.ac_scope`), reporting `notApplicable(scope-undeclared)` when no
 *     evidence-bearing task declares one. The scenario now proves BOTH halves of
 *     that change through the compiled artifact: an undeclared-scope plan with an
 *     unattested exercised AC ARCHIVES (exit 0, no attestation-floor field), and —
 *     as the CONTROL that the floor still has teeth — a sibling plan under an
 *     explicitly configured `workflow.attestation.min_ratio` is DENIED at exit 4
 *     until `lore verify` attests the SAME task's evidence, two runs of one
 *     command differing only in that fact. The declared conjunct's own
 *     compiled-binary oracle belongs with `lore scope add` (a sibling task of the
 *     same spec) — this suite cannot author `ac_scope` through the binary yet.
 *
 * Freshness guard (repo CLAUDE.md "false-oracle vectors" #4 — a stale
 * `dist/lore` silently validates stale compiled logic against current
 * source): `beforeAll` calls `assertFreshBinary`. Run `bun run build`
 * (repo root) before this suite.
 *
 * @spec_ref spec-plan-close-predicates-measure-invariants-an-applicability
 *   §Design Decisions D2, D3, D4, D6; §Acceptance Criteria AC-PCI-12.
 *   Task task-t5-compiled-binary-e2e-from-a-throwaway-corpus-clean-close.
 *
 * TG-25 (adr-tg-1 option b): the commands run IN-PROCESS through tests/helpers/run-lore-in-process.ts, not through
 * dist/lore. Wherever the prose above says the compiled binary is spawned or its freshness asserted, that is the
 * history of this file; the assertions and the throwaway-corpus rule are unchanged.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FIXTURE_HOME_OUTSIDE_REPO, makeCleanTreeRepo } from "../helpers/clean-tree-repo";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { saveConfig } from "@lore/core/node";
import type { LoreConfig } from "@lore/core";
import { citeSpecViaAsyncCli, asyncLoreRunnerFor } from "../helpers/cli-live-rule.js";
import { runLoreInProcess } from "../helpers/run-lore-in-process";
import { planFieldsArgs, templatedFieldsArgs } from "../helpers/templated-create";

// ─── Path / spawn setup ─────────────────────────────────────────────────────

// tests/e2e/ -> tests/ -> packages/lore/ -> packages/ -> repo root (4 levels up),
// mirrors every sibling compiled-binary e2e suite's own REPO_ROOT derivation.
const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");

/** The one script-mode AC id both sibling plans claim. */
const AC_ID = "AC-E2E-1";
/** Genuinely trivially green, never a real test-file path (`oracle: "other"` — see module header). */
const AC_COMMAND = "true";

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/**
 * Spawns the COMPILED `dist/lore` binary. `CLAUDECODE=1` resolves the "agent"
 * caller surface (SPEC-024) so no `create`/`approve` call risks a nested AI
 * invocation; a fixed `LORE_ACTOR` keeps every write attributable to one
 * stable identity and avoids an unrelated actor-traceability warning polluting
 * the exact stderr assertions below (mirrors `approve-advisory-render.test.ts`).
 */
async function runLore(args: string[], cwd: string, envOverrides: Record<string, string> = {}): Promise<RunResult> {
  const proc = await runLoreInProcess(args, {
    cwd,
    home: FIXTURE_HOME_OUTSIDE_REPO,
    env: {
      ...process.env,
      HOME: FIXTURE_HOME_OUTSIDE_REPO,
      CLAUDECODE: "1",
      LORE_ACTOR: "agent:t5-pci12-probe",
      ...envOverrides,
    },
  });
  return {
    stdout: proc.stdout,
    stderr: proc.stderr,
    exitCode: proc.exitCode,
  };
}

function parseSlug(stdout: string): string {
  const match = stdout.match(/Slug:\s+(\S+)/);
  const slug = match?.[1];
  if (slug === undefined) {
    throw new Error(`could not parse slug from create output: ${stdout}`);
  }
  return slug;
}

const cleanupDirs: string[] = [];

function trackDir(dir: string): string {
  cleanupDirs.push(dir);
  return dir;
}

function cleanupAll(): void {
  while (cleanupDirs.length > 0) {
    const dir = cleanupDirs.pop()!;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  }
}

afterAll(() => {
  cleanupAll();
});

// ─── Corpus-building helpers ────────────────────────────────────────────────

/**
 * Writes `.lore/config.yaml` — `cited_rule_check` ON, NO `workflow.attestation
 * .min_ratio` key at all (§D4: absent means `resolveAttestationMinRatio` ===
 * null, the ratio conjunct never runs — the per-claimed-AC coverage conjunct
 * is the only thing this suite is proving), and
 * `review.judgment_required_types: []` (neutralizes the unrelated SPEC-103
 * gate on the spec approval below).
 *
 * `task-create` (spec-declaring-ac-scope-is-required-at-task-creation-so-the)
 * is disabled here for a DIFFERENT reason than the others: scenario B/PCI-21
 * deliberately construct a task that declares NO `ac_scope` at all — that
 * absence is the exact precondition `plan-close`'s declared-scope-coverage
 * conjunct (§Facts D4/D5) is being proven against. Since this suite "cannot
 * author `ac_scope` through the binary yet" (module header), the ONLY way to
 * construct that state under a spec that now REQUIRES declaring it at create
 * time is to disable the admission checkpoint for this fixture's corpus —
 * `task-create` and `plan-close` are two independent checkpoints; disabling
 * the former changes nothing about the latter's behavior under test here.
 */
function writeConfig(dir: string): void {
  const config: LoreConfig = {
    project: { name: "t5-pci12-compiled-e2e", author: "t5-tester" },
    workflow: {
      gates: {
        "plan-close": { cited_rule_check: { enabled: true } },
        "task-create": { enabled: false },
      },
      review: { judgment_required_types: [] },
    },
  } as unknown as LoreConfig;
  const result = saveConfig(dir, config);
  if (!result.ok) {
    throw new Error(`saveConfig failed: ${JSON.stringify(result.error)}`);
  }
}

/**
 * Rewrites `.lore/config.yaml` with the SAME keys as {@link writeConfig} plus an
 * explicit `workflow.attestation.min_ratio` — scenario B's control needs the ONE
 * blocking conjunct a pure-CLI fixture can still reach after
 * spec-declared-scope-attestation-contract-task-owned-ac-scope §Facts D4/D5
 * (the declared-scope conjunct needs `task.extra.ac_scope`, whose writer is a
 * sibling task of that spec). Called mid-suite, AFTER scenario A has run, so
 * scenario A keeps measuring the unconfigured-ratio default it is written against.
 */
function writeConfigWithRatioFloor(dir: string, minRatio: number): void {
  const config: LoreConfig = {
    project: { name: "t5-pci12-compiled-e2e", author: "t5-tester" },
    workflow: {
      gates: {
        "plan-close": { cited_rule_check: { enabled: true } },
        "task-create": { enabled: false },
      },
      review: { judgment_required_types: [] },
      attestation: { min_ratio: minRatio },
    },
  } as unknown as LoreConfig;
  const result = saveConfig(dir, config);
  if (!result.ok) {
    throw new Error(`saveConfig (ratio floor) failed: ${JSON.stringify(result.error)}`);
  }
}

async function initCorpus(dir: string): Promise<void> {
  makeCleanTreeRepo(dir);
  const initResult = await runLore(["init"], dir);
  if (initResult.exitCode !== 0) {
    throw new Error(`lore init failed: ${initResult.stderr}`);
  }
  writeConfig(dir);
}

async function createPrd(dir: string, title: string): Promise<string> {
  const r = await runLore(["create", "prd", "--title", title, ...templatedFieldsArgs("prd"), "--no-ai"], dir);
  if (r.exitCode !== 0) throw new Error(`create prd failed: ${r.stderr}`);
  return parseSlug(r.stdout);
}

/** Parented DIRECTLY under the PRD — no `implements` edge declared anywhere,
 *  so it resolves NO domain doc (historically §D6; irrelevant since BR-984). */
async function createSpec(dir: string, prdSlug: string, title: string): Promise<string> {
  const r = await runLore(
    ["create", "spec", "--title", title, ...templatedFieldsArgs("spec", { kind: "feature", refTarget: prdSlug }), "--no-ai"],
    dir,
  );
  if (r.exitCode !== 0) throw new Error(`create spec failed: ${r.stderr}`);
  return parseSlug(r.stdout);
}

async function addScriptAc(dir: string, specSlug: string, acId: string, command: string): Promise<void> {
  const r = await runLore(
    [
      "ac",
      "add",
      specSlug,
      acId,
      "--statement",
      "the compiled binary archives a plan whose claimed AC is attested",
      "--mode",
      "script",
      "--oracle",
      "other",
      "--command",
      command,
    ],
    dir,
  );
  if (r.exitCode !== 0) throw new Error(`ac add failed: ${r.stderr}`);
}

async function createPlan(dir: string, specSlug: string, title: string): Promise<string> {
  const r = await runLore(
    ["create", "plan", "--title", title, "--parent", specSlug, ...planFieldsArgs(specSlug), "--no-ai"],
    dir,
  );
  if (r.exitCode !== 0) throw new Error(`create plan failed: ${r.stderr}`);
  return parseSlug(r.stdout);
}

async function createTask(dir: string, planSlug: string, title: string, kind: "code" | "check" | "corpus", acId: string): Promise<string> {
  const r = await runLore(
    [
      "create",
      "task",
      "--title",
      title,
      "--kind",
      kind,
      "--plan-id",
      planSlug,
      "--ac-scope",
      acId,
      ...templatedFieldsArgs("task"),
      "--no-ai",
    ],
    dir,
  );
  if (r.exitCode !== 0) throw new Error(`create task failed: ${r.stderr}`);
  return parseSlug(r.stdout);
}

/**
 * Declares a task's `extra.ac_scope` through the compiled binary's dedicated
 * writer (`lore scope add` — there is deliberately no `lore set --ac-scope`,
 * since `set` replaces `extra` wholesale).
 *
 * This suite's module header used to record that it "cannot author `ac_scope`
 * through the binary yet"; that writer has since shipped, and
 * task-plan-close-must-block-when-the-coverage-conjunct-is-scope makes an
 * undeclared scope a DENIAL, so every scenario expecting a clean close must now
 * declare what its task owns.
 */
async function declareScope(dir: string, taskSlug: string, acId: string): Promise<RunResult> {
  return await runLore(["scope", "add", taskSlug, acId], dir);
}

/** Records ATTESTED evidence via the trusted-runner path (SPEC-039) — the ONLY
 *  legitimate producer of an `attestation`-bearing entry; never hand-crafted. */
async function verifyAttested(dir: string, planSlug: string, taskSlug: string, acId: string): Promise<RunResult> {
  return await runLore(["verify", planSlug, "--task", taskSlug, "--ac", acId, "--allow-new-commands"], dir);
}

/** Records SELF-REPORTED (never attested) evidence via `lore evidence`. */
// reason: SUPERSEDED oracle (task-raise-the-evidence-tail-guard-s-predicate-
// to-its-own) — "other" self-report is now refused regardless of tail
// content; "manual" is the one oracle that still lets a genuinely non-empty
// self-reported tail succeed, and — same as "other" — falls outside the
// SPEC-061 attestation-completeness guard's and the missing-oracle-file
// precheck's test/e2e-only scope (see this file's own module header), so
// this fixture's other invariants are unaffected by the switch.
async function evidenceSelfReported(dir: string, taskSlug: string, acId: string, command: string): Promise<RunResult> {
  return await runLore(
    ["evidence", taskSlug, "--oracle", "manual", "--command", command, "--result", "pass", "--ac", acId, "--output-tail", "ok"],
    dir,
  );
}

async function approvePlan(dir: string, planSlug: string): Promise<RunResult> {
  return await runLore(["approve", planSlug], dir);
}

async function archivePlan(dir: string, planSlug: string): Promise<RunResult> {
  return await runLore(["set", planSlug, "--status", "archived"], dir);
}

// ─── Suite ───────────────────────────────────────────────────────────────────

/**
 * AC-AP-6 (spec-approval-and-plan-closure-go-through-the-same-checks-on, BR-1072,
 * D7, issue #47) — the compiled `lore set <plan> --status archived` says, in HUMAN
 * output too, which tasks the cascade archived and which it left open and why.
 *
 * Its OWN throwaway corpus. The `plan-close` gate is switched OFF here (BR-214) so
 * the plan itself closes regardless of attestation scope. Both tasks are `check`
 * tasks owning the spec's script AC, approved with the contract compiled at approve
 * (a check task needs no red run and no branch to land). The cascade's per-task
 * floors are NOT switched off by that config, so the only thing that differs
 * between A and B is the evidence: A holds a runner-attested pass (`lore verify`)
 * for its contract oracle, B holds none.
 */
function writeConfigPlanCloseGateOff(dir: string): void {
  const config: LoreConfig = {
    project: { name: "ap6-compiled-e2e", author: "ap6-tester" },
    workflow: {
      gates: {
        "plan-close": { enabled: false },
        "task-create": { enabled: false },
      },
      review: { judgment_required_types: [] },
    },
  } as unknown as LoreConfig;
  const result = saveConfig(dir, config);
  if (!result.ok) throw new Error(`saveConfig failed: ${JSON.stringify(result.error)}`);
}

describe("AC-AP-6: compiled plan close prints the cascade in human output and carries the floor in --json", () => {
  let dir: string;
  let specSlug: string;

  beforeAll(async () => {
    dir = trackDir(mkdtempSync(join(tmpdir(), "lore-ap6-")));
    expect(dir.startsWith(REPO_ROOT)).toBe(false);
    makeCleanTreeRepo(dir);
    const initResult = await runLore(["init"], dir);
    if (initResult.exitCode !== 0) throw new Error(`lore init failed: ${initResult.stderr}`);
    writeConfigPlanCloseGateOff(dir);

    const prdSlug = await createPrd(dir, "AP-6 Root PRD");
    specSlug = await createSpec(dir, prdSlug, "AP-6 Governing Spec");
    await addScriptAc(dir, specSlug, AC_ID, AC_COMMAND);
    await citeSpecViaAsyncCli(asyncLoreRunnerFor(runLore, dir), dir, undefined, specSlug, AC_ID);
    const approveSpec = await runLore(["approve", specSlug], dir);
    if (approveSpec.exitCode !== 0) throw new Error(`approve spec failed (setup): ${approveSpec.stderr}`);
  });

  /** One plan, attested task A, evidence-less task B, plan approved and ready to close. */
  async function seedPlan(label: string): Promise<{ planSlug: string; a: string; b: string }> {
    const planSlug = await createPlan(dir, specSlug, `AP-6 Plan ${label}`);
    // check tasks: they hold the AC's script oracle in the contract compiled at approve, and need no branch to land
    const a = await createTask(dir, planSlug, `AP-6 Task A ${label}`, "check", AC_ID);
    const b = await createTask(dir, planSlug, `AP-6 Task B ${label}`, "check", AC_ID);
    for (const slug of [a, b]) {
      const approvedTask = await runLore(["approve", slug], dir);
      if (approvedTask.exitCode !== 0) throw new Error(`approve task failed (setup): ${approvedTask.stdout}${approvedTask.stderr}`);
    }
    const verified = await verifyAttested(dir, planSlug, a, AC_ID);
    if (verified.exitCode !== 0) throw new Error(`verify A failed (setup): ${verified.stdout}${verified.stderr}`);
    const approved = await approvePlan(dir, planSlug);
    if (approved.exitCode !== 0) throw new Error(`approve plan failed (setup): ${approved.stderr}`);
    return { planSlug, a, b };
  }

  it("AP-6 human: stdout names the archived task and the skipped task with its floor, and the skipped task stays open", async () => {
    const { planSlug, a, b } = await seedPlan("human");

    const closed = await archivePlan(dir, planSlug);
    expect(closed.exitCode).toBe(0);

    const lines = closed.stdout.split("\n").map((l) => l.trim());
    expect(lines, `stdout was:\n${closed.stdout}`).toContain(`Cascade archived: ${a}`);
    expect(lines, `stdout was:\n${closed.stdout}`).toContain(`Cascade skipped: ${b} (attested-pass)`);

    const getB = await runLore(["get", b], dir);
    expect(getB.exitCode).toBe(0);
    expect(getB.stdout).not.toContain("Status: archived");
    const getA = await runLore(["get", a], dir);
    expect(getA.stdout).toContain("Status: archived");
  });

  it("AP-6 json: the same close with --json carries cascade.skipped[0].floor === 'attested-pass'", async () => {
    const { planSlug, a, b } = await seedPlan("json");

    const closed = await runLore(["set", planSlug, "--status", "archived", "--json"], dir);
    expect(closed.exitCode).toBe(0);

    const parsed = JSON.parse(closed.stdout) as {
      data: {
        cascade: {
          archived: Array<{ slug: string }>;
          skipped: Array<{ slug: string; floor?: string }>;
        };
      };
    };
    expect(parsed.data.cascade.archived.map((x) => x.slug)).toEqual([a]);
    expect(parsed.data.cascade.skipped.map((x) => x.slug)).toEqual([b]);
    expect(parsed.data.cascade.skipped[0]!.floor).toBe("attested-pass");
  });
});
