// @spawns packages/lore/src/index.ts
/**
 * AC-GV-6 (spec-governance-visibility-an-armed-gate-that-vacuously-passes §B1.1,
 * task-assert-the-plan-close-vacuity-discriminator-on-the-render) — the plan-close
 * gate's USER-FACING output must distinguish a VACUOUS pass (no applicable data —
 * "four plans were archived by riding a vacuous predicate", §B1) from a genuinely
 * SATISFIED one, in BOTH the human render and the `--json` payload of
 * `lore set <plan> --status archived`.
 *
 * ⛔ AC-GV-1's own re-baseline note is why this file exists: the landed
 * `plan-close-predicate-provenance.test.ts` only ever asserted `checkPlanClose`'s
 * RETURNED VERDICT OBJECTS and `JSON.stringify` of those same objects — never the
 * CLI/render surface. "The human render shows it" passed BY ASSUMPTION. Measured
 * directly against a throwaway corpus BEFORE this task's fix landed: a vacuous
 * close and a satisfied close both serialized to `"extra": {}` on `lore set
 * --status archived --json`'s stdout — byte-identical, no discriminator anywhere a
 * `--json` consumer could read. This suite drives the ACTUAL CLI process; it never
 * re-serialises `checkPlanClose`'s return value.
 *
 * Entry point driven: `bun run <PACKAGE_ROOT>/src/index.ts` — the WORKTREE's own
 * TypeScript source (never the global `lore` binary, a symlink into the MAIN
 * checkout's compiled `dist/lore` — see root CLAUDE.md's standing lesson on that
 * symlink). `commands/set.ts` transitively imports `loader.ts` -> `app.ts` ->
 * `bun:sqlite`, unresolvable by vitest as a direct import — spawning the real CLI
 * (mirroring `ac-demotion-notice.test.ts`/`approve-advisory-render.test.ts`'s proven
 * subprocess pattern) is the only way to exercise this surface from vitest at all.
 *
 * Fixtures never write to this repo's own `.lore/` — every corpus is a throwaway
 * `mkdtemp` + `lore init`.
 *
 * Coverage (six dimensions, ALL under the `surface-discriminator` token this
 * task's oracle command filters on — a filter keyed on a remembered phrase
 * degrades silently to no-match, so every title carries the bare token):
 *   HAPPY:      a VACUOUS plan-close (no tasks, no linked assessment) carries the
 *               discriminator in BOTH the `--json` payload's `extra` AND the plain
 *               human stdout summary line.
 *   NEGATIVE:   a SATISFIED plan-close (real attested evidence, explicit empty
 *               `ac_scope` declaration) carries NEITHER — silence, not a
 *               contradicting-but-present marker.
 *   BOUNDARY:   the `--json` payload's discriminator text and the PRE-EXISTING
 *               `GateEnforcer.enforce`/`warnVacuousCheckpoint` stderr notice (same
 *               process, same call) are the SAME string — one SSOT, not two
 *               divergently-derived renderings.
 *   ERROR:      neither the vacuous nor the satisfied close's process exits
 *               non-zero — a not-applicable verdict must never became a hard
 *               failure merely because this task made it visible.
 *   STATE:      one shared corpus closing a vacuous plan and a satisfied plan in
 *               sequence keeps their discriminators independent — no leakage
 *               between the two `lore set` invocations.
 *   REGRESSION: a plan closing via BOTH audited attestation/assessment-freshness
 *               exemptions (zero predicates ever run — a DIFFERENT vacuous-shaped
 *               fact this mechanism deliberately does not flag, per
 *               `describeCheckpointVacuity`'s own "ran no predicates at all is a
 *               different fact" contract) carries NO vacuity discriminator, while
 *               the pre-existing, independent `formatAttestationExemptionNotice`
 *               mechanism still fires — proving this task's new field never
 *               clobbers or duplicates that unrelated channel.
 *
 * @spec_ref spec-governance-visibility-an-armed-gate-that-vacuously-passes §B1.1 AC-GV-6
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "child_process";
import { appendFileSync, mkdtempSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { FIXTURE_HOME_OUTSIDE_REPO, makeCleanTreeRepo } from "../../helpers/clean-tree-repo.js";

// tests/unit/adapters/ → tests/unit/ → tests/ → packages/lore/
const PACKAGE_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");

const VACUOUS_TOKEN = "VACUOUS-GATE";

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** Spawn the REAL CLI (worktree source, never the global symlinked binary) in
 *  `cwd`, mirroring `ac-demotion-notice.test.ts`'s proven subprocess pattern. */
function runLore(args: string[], cwd: string): RunResult {
  const result = spawnSync("bun", ["run", INDEX_TS, ...args], {
    cwd,
    env: { ...process.env, HOME: FIXTURE_HOME_OUTSIDE_REPO, EDITOR: "true", LORE_ACTOR: "agent:plan-close-render-probe" },
    encoding: "utf8",
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status ?? 1,
  };
}

function parseSlug(stdout: string): string {
  const match = stdout.match(/Slug:\s+(\S+)/);
  const slug = match?.[1];
  if (slug === undefined) throw new Error(`could not parse slug from output: ${stdout}`);
  return slug;
}

function createPrd(dir: string, title: string): string {
  const r = runLore(["create", "prd", "--title", title, "--content", "PRD body.", "--no-ai"], dir);
  if (r.exitCode !== 0) throw new Error(`create prd failed: ${r.stderr}`);
  return parseSlug(r.stdout);
}

function createPlan(dir: string, parentSlug: string, title: string): string {
  const r = runLore(
    ["create", "plan", "--title", title, "--parent", parentSlug, "--content", "## Plan\n\nbody", "--no-ai"],
    dir,
  );
  if (r.exitCode !== 0) throw new Error(`create plan failed: ${r.stderr}`);
  return parseSlug(r.stdout);
}

function createTaskWithEmptyScope(dir: string, planSlug: string, title: string): string {
  const r = runLore(
    [
      "create",
      "task",
      "--plan-id",
      planSlug,
      "--title",
      title,
      "--content",
      "task body",
      "--ac-scope",
      "",
      "--no-ai",
    ],
    dir,
  );
  if (r.exitCode !== 0) throw new Error(`create task failed: ${r.stderr}`);
  return parseSlug(r.stdout);
}

/** One working copy carries one unlanded task (BR-1337) and plan close archives only landed work (BR-1291): each task
 *  claims its own branch (nothing past main), which `lore integrate` finds already integrated and records on it. */
function claimTask(dir: string, taskSlug: string): void {
  const branch = `gv6-${taskSlug}`;
  const made = spawnSync("git", ["branch", branch, "main"], { cwd: dir, encoding: "utf8" });
  if (made.status !== 0) throw new Error(`git branch ${branch} failed: ${made.stderr}`);
  const r = runLore(["claim", taskSlug, "--worktree", branch], dir);
  if (r.exitCode !== 0) throw new Error(`claim ${taskSlug} failed: ${r.stderr}`);
  const landed = runLore(["integrate", branch, "--session", "gv6-integrate"], dir);
  if (landed.exitCode !== 0) throw new Error(`integrate ${branch} failed: ${landed.stderr}${landed.stdout}`);
}

/** Records ONE runner-attested (`--capture`), genuinely non-empty-output evidence
 *  row — real evidence, real exit 0 — the fact `attestationFloor` needs to return a
 *  genuinely MEASURED pass rather than a `notApplicable("no-evidence")` verdict. */
function addAttestedEvidence(dir: string, taskSlug: string): void {
  const r = runLore(
    ["evidence", taskSlug, "--oracle", "test", "--capture", "--command", "echo probe-ok", "--result", "pass"],
    dir,
  );
  if (r.exitCode !== 0) throw new Error(`evidence ${taskSlug} failed: ${r.stderr}`);
}

function setStatus(dir: string, slug: string, status: string): void {
  const r = runLore(["set", slug, "--status", status], dir);
  if (r.exitCode !== 0) throw new Error(`set ${slug} --status ${status} failed: ${r.stderr}`);
}

function exemptAttestation(dir: string, planSlug: string): void {
  const r = runLore(
    ["plan", "exempt-attestation", planSlug, "--kind", "no-oracle", "--reason", "surface-discriminator regression fixture"],
    dir,
  );
  if (r.exitCode !== 0) throw new Error(`exempt-attestation ${planSlug} failed: ${r.stderr}`);
}

function exemptAssessmentFreshness(dir: string, planSlug: string): void {
  const r = runLore(
    ["plan", "exempt-assessment-freshness", planSlug, "--reason", "surface-discriminator regression fixture"],
    dir,
  );
  if (r.exitCode !== 0) throw new Error(`exempt-assessment-freshness ${planSlug} failed: ${r.stderr}`);
}

/** Runs a plan through draft -> approved -> active, stopping short of archival —
 *  the caller decides how (and with what flags) to close it. */
function bringToActive(dir: string, planSlug: string): void {
  setStatus(dir, planSlug, "approved");
  setStatus(dir, planSlug, "active");
}

function archivePlan(dir: string, planSlug: string, jsonMode: boolean): RunResult {
  const args = jsonMode ? ["set", planSlug, "--status", "archived", "--json"] : ["set", planSlug, "--status", "archived"];
  return runLore(args, dir);
}

interface JsonSetPayload {
  readonly ok: boolean;
  readonly data: { readonly extra: Record<string, unknown> };
}

let tmpDir: string;
let prdSlug: string;

// One shared corpus + fixture matrix, built ONCE (beforeAll, not beforeEach) —
// every `it()` below reads a DIFFERENT already-archived plan, so there is no
// cross-test mutation to isolate against, and building 5+ plans' worth of
// create/claim/evidence/status-transition subprocess chains once instead of per
// test keeps this suite's wall-clock cost proportional to the fixture count, not
// the assertion count.
let vacuousJson: RunResult;
let vacuousHuman: RunResult;
let satisfiedJson: RunResult;
let satisfiedHuman: RunResult;
let bothExemptJson: RunResult;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "lore-plan-close-render-"));
  makeCleanTreeRepo(tmpDir);
  const init = runLore(["init", "--author", "plan-close-render-probe"], tmpDir);
  if (init.exitCode !== 0) throw new Error(`lore init failed: ${init.stderr}`);
  // reason: a positive trace of execution, not merely a zero exit code (root
  // CLAUDE.md's "an EMPTY output artifact is the same shape as a clean one"
  // lesson) — the throwaway corpus's own db file must actually exist on disk.
  if (!existsSync(join(tmpDir, ".lore", "lore.db"))) {
    throw new Error(`lore init reported success but produced no .lore/lore.db under ${tmpDir}`);
  }

  // reason: plans are judged by default (BR-281 / BR-1237); these fixtures approve plans only to reach
  // plan-close rendering, never review-judgment.
  appendFileSync(join(tmpDir, ".lore", "config.yaml"), "workflow:\n  review:\n    judgment_required_types: []\n  integrate:\n    floor_command: \"true\"\n", "utf8");
  appendFileSync(join(tmpDir, ".git", "info", "exclude"), ".claude/\n"); // `lore integrate` keeps its worktree there

  prdSlug = createPrd(tmpDir, "GV6 PRD");

  // --- VACUOUS fixtures: a plan with ZERO tasks and no linked assessment at all
  //     — attestationFloor AND assessmentFreshness both report notApplicable
  //     ("no-evidence"), so the WHOLE checkpoint is vacuous.
  const vacuousJsonPlan = createPlan(tmpDir, prdSlug, "GV6 Vacuous JSON");
  bringToActive(tmpDir, vacuousJsonPlan);
  vacuousJson = archivePlan(tmpDir, vacuousJsonPlan, true);

  const vacuousHumanPlan = createPlan(tmpDir, prdSlug, "GV6 Vacuous Human");
  bringToActive(tmpDir, vacuousHumanPlan);
  vacuousHuman = archivePlan(tmpDir, vacuousHumanPlan, false);

  // --- SATISFIED fixtures: one task carrying REAL runner-attested evidence and
  //     an explicit empty `ac_scope` declaration ("no criterion claimed", a
  //     RESOLVED fact, not an unresolved one) — attestationFloor returns a
  //     genuinely MEASURED `{ok: true}`, so the checkpoint is NOT vacuous
  //     regardless of assessmentFreshness's own (unrelated) not-applicable entry.
  const satisfiedJsonPlan = createPlan(tmpDir, prdSlug, "GV6 Satisfied JSON");
  const satisfiedJsonTask = createTaskWithEmptyScope(tmpDir, satisfiedJsonPlan, "GV6 Satisfied JSON Task");
  claimTask(tmpDir, satisfiedJsonTask);
  addAttestedEvidence(tmpDir, satisfiedJsonTask);
  bringToActive(tmpDir, satisfiedJsonPlan);
  satisfiedJson = archivePlan(tmpDir, satisfiedJsonPlan, true);

  const satisfiedHumanPlan = createPlan(tmpDir, prdSlug, "GV6 Satisfied Human");
  const satisfiedHumanTask = createTaskWithEmptyScope(tmpDir, satisfiedHumanPlan, "GV6 Satisfied Human Task");
  claimTask(tmpDir, satisfiedHumanTask);
  addAttestedEvidence(tmpDir, satisfiedHumanTask);
  bringToActive(tmpDir, satisfiedHumanPlan);
  satisfiedHuman = archivePlan(tmpDir, satisfiedHumanPlan, false);

  // --- REGRESSION fixture: BOTH audited exemptions declared, zero tasks — every
  //     plan-close predicate is skipped by its own OPT-OUT/OPT-IN precondition
  //     before it ever runs (checkPlanClose pushes NOTHING at all), a
  //     "zero predicates ran" fact `describeCheckpointVacuity` deliberately does
  //     NOT call vacuous (its own documented "ran no predicates at all is a
  //     DIFFERENT fact" contract) — while the pre-existing, unrelated
  //     attestation-exemption notice still fires.
  const bothExemptPlan = createPlan(tmpDir, prdSlug, "GV6 Both Exempt");
  exemptAttestation(tmpDir, bothExemptPlan);
  exemptAssessmentFreshness(tmpDir, bothExemptPlan);
  bringToActive(tmpDir, bothExemptPlan);
  bothExemptJson = archivePlan(tmpDir, bothExemptPlan, true);
}, 120_000);

afterAll(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

describe("surface-discriminator — plan-close vacuity is visible on the render surface, never only on the predicate objects (AC-GV-6)", () => {
  it("surface-discriminator HAPPY: a vacuous close carries the discriminator in BOTH the --json payload and the human stdout summary", () => {
    expect(vacuousJson.exitCode).toBe(0);
    const payload = JSON.parse(vacuousJson.stdout) as JsonSetPayload;
    expect(payload.ok).toBe(true);
    const jsonNotice = payload.data.extra["plan_close_vacuity_notice"];
    expect(typeof jsonNotice).toBe("string");
    expect(jsonNotice as string).toContain(VACUOUS_TOKEN);

    expect(vacuousHuman.exitCode).toBe(0);
    expect(vacuousHuman.stdout).toContain(VACUOUS_TOKEN);
  });

  it("surface-discriminator NEGATIVE: a satisfied close carries the discriminator in NEITHER the --json payload NOR the human stdout summary", () => {
    expect(satisfiedJson.exitCode).toBe(0);
    const payload = JSON.parse(satisfiedJson.stdout) as JsonSetPayload;
    expect(payload.ok).toBe(true);
    expect(payload.data.extra["plan_close_vacuity_notice"]).toBeUndefined();

    expect(satisfiedHuman.exitCode).toBe(0);
    expect(satisfiedHuman.stdout).not.toContain(VACUOUS_TOKEN);
  });

  it("surface-discriminator BOUNDARY: the --json payload's notice and the pre-existing stderr notice from the SAME close are the identical string", () => {
    const payload = JSON.parse(vacuousJson.stdout) as JsonSetPayload;
    const jsonNotice = payload.data.extra["plan_close_vacuity_notice"] as string;
    // reason: `warnVacuousCheckpoint` (gate-enforcer.ts) writes this SAME
    // `describeCheckpointVacuity` string to stderr on every `enforce("plan-close",
    // …)` call, regardless of `--json` — it is the pre-existing human-render half
    // this task's field completes, never a second, independently-worded notice.
    expect(vacuousJson.stderr).toContain(jsonNotice);
  });

  it("surface-discriminator ERROR: neither the vacuous nor the satisfied close's process exits non-zero", () => {
    expect(vacuousJson.exitCode).toBe(0);
    expect(vacuousHuman.exitCode).toBe(0);
    expect(satisfiedJson.exitCode).toBe(0);
    expect(satisfiedHuman.exitCode).toBe(0);
  });

  it("surface-discriminator STATE: the vacuous and satisfied discriminators stay independent across sequential closes in the SAME corpus", () => {
    const vacuousPayload = JSON.parse(vacuousJson.stdout) as JsonSetPayload;
    const satisfiedPayload = JSON.parse(satisfiedJson.stdout) as JsonSetPayload;
    expect(typeof vacuousPayload.data.extra["plan_close_vacuity_notice"]).toBe("string");
    expect(satisfiedPayload.data.extra["plan_close_vacuity_notice"]).toBeUndefined();
    // The two payloads' `extra` never accidentally converge to the same JSON text.
    expect(JSON.stringify(vacuousPayload.data.extra)).not.toBe(JSON.stringify(satisfiedPayload.data.extra));
  });

  it("surface-discriminator REGRESSION: a both-exempt close (zero predicates ever ran) carries NO vacuity discriminator, while the pre-existing exemption notice still fires", () => {
    expect(bothExemptJson.exitCode).toBe(0);
    const payload = JSON.parse(bothExemptJson.stdout) as JsonSetPayload;
    expect(payload.ok).toBe(true);
    expect(payload.data.extra["plan_close_vacuity_notice"]).toBeUndefined();
    // The unrelated, pre-existing exemption mechanism (SPEC-069 §Mechanism item 3)
    // is unaffected by this task's new field.
    expect(payload.data.extra["attestation_exempt"]).toBe(true);
    expect(payload.data.extra["assessment_freshness_exempt"]).toBe(true);
  });
});
