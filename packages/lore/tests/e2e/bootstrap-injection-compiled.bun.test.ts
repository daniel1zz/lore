/**
 * @spec_ref SPEC-080 §Projection Contract, §Public Interface — task
 *   task-skill-test-t6-compiled-binary-e2e-injection-knobs-json-pin,
 *   AC-080-3, AC-080-6.
 *
 * RETIRED CASES (spec-session-start-injection-carries-only-the-session-s-own
 * D10): the cases asserting the old tier-1 injection payload (contract key
 * order, seat-scoped resume_hint slot, count knobs, archive_candidates
 * surfacing) were DELETED; the seat-only replacements live in
 * `bootstrap-seat-injection-compiled.bun.test.ts` (AC-SI-2, AC-SI-4). The
 * descriptions below that mention them are historical.
 *
 * Compiled-binary end-to-end oracle for `lore bootstrap --injection` (the
 * tier-1 SessionStart-hook payload) and its `workflow.bootstrap_injection.*`
 * config knobs. Every prior SPEC-080 AC (AC-080-1/2/4/5) is vitest/source-mode
 * — this is the first and only one that spawns the COMPILED `dist/lore`
 * binary directly (`Bun.spawnSync`), mirroring
 * `tests/integration/cli/slugify-compiled.bun.test.ts`'s AC-068-10 precedent
 * and `tests/e2e/setup-freshness-cycle.bun.test.ts`'s own compiled-binary
 * harness. This closes the same "compiled binary never independently
 * verified" gap for the SPEC-080 projection: `buildBootstrapInjection`'s own
 * unit suite (AC-080-1) never touches `commands/bootstrap.ts`'s CLI wiring
 * (budget resolution from a REAL parsed `.lore/config.yaml`, `--injection`
 * vs `--json` dispatch, strict-flags rejection of an unknown flag) at all.
 *
 * Freshness guard (SPEC-061 lesson — a stale `dist/lore` is a false oracle):
 * `beforeAll` calls `assertFreshBinary`, throwing loud before any test body
 * runs if `dist/lore` is missing or older than the newest `.ts` source under
 * `packages/{lore,core}/src` — run `bun run build` (repo root) first.
 *
 * Never touches the repo's own `.lore/` corpus (project CLAUDE.md hard rule,
 * `packages/dashboard/tests/e2e/global-setup.ts` precedent) — every scenario
 * seeds a THROWAWAY corpus via `mkdtempSync(os.tmpdir())` + `dist/lore init`,
 * asserted (via `expect(dir.startsWith(REPO_ROOT)).toBe(false)`) to live
 * genuinely outside this repo's working tree.
 *
 * Fixture shape shared by both describe blocks (`seedCorpus`): a root PRD +
 * 3 plans in MIXED states — "Plan A"/"Plan B" each carry one draft,
 * unclaimed, unblocked task (`ready: 1, claimed: 0` — actionable,
 * `ready>0 ∨ claimed>0`), "Plan C" carries zero tasks (`ready: 0, claimed: 0`
 * — dead, excluded from the injection's `active_plans` regardless of the
 * `max_active_plans` cap, SPEC-080 D4) — plus one handoff on each of Plan
 * A/Plan B (two distinct per-plan handoff groups, `SessionService.bootstrap`
 * groups by parent plan and keeps only the newest per group). Per SPEC-103
 * M1, the ledger sub_type `handoff` fast-tracks draft→approved at create, so
 * the 2 handoff docs land `status: "approved"` immediately and never enter
 * the pending queue; the other 6 created docs (prd + 3 plans + 2 tasks) are
 * never approved and stay `status: "draft"` — a ready-made non-trivial
 * pending queue with zero extra authoring, closing this suite's "pending
 * drafts" seeding requirement for free.
 *
 * Coverage:
 *   HAPPY:      `--injection` (default budgets) parses as COMPACT JSON whose
 *               key order is byte-exact to the SPEC-080 §Projection Contract
 *               literal list, `omitted` is the single typed ledger, the dead
 *               plan is absent from `active_plans`.
 *   REGRESSION: plain `--json` on the SAME corpus has EXACTLY the literal
 *               9-key `BootstrapReport` set (AC-080-3's second half) — never
 *               touched by the injection projection.
 *   NEGATIVE:   `--injectoin` (typo) exits 2 (SPEC-051 strict-flags).
 *   STATE:      `--injection --json` combined takes the SAME `--injection`
 *               precedence documented in `commands/bootstrap.ts`'s own module
 *               header (T3's decision, re-confirmed by reviewer finding
 *               2026-07-26) — byte-identical output, never a rejection.
 *   BOUNDARY:   non-default `workflow.bootstrap_injection` knobs
 *               (`max_active_plans/max_handoffs/max_pending_slugs: 1`,
 *               `char_budget: 2000`) reach the projection end-to-end: exactly
 *               1 kept entry per capped array, the `omitted` ledger accounts
 *               for every excess entry (including the dead-plan-fold-in per
 *               `buildBootstrapInjection`'s documented D4 formula), and the
 *               resulting payload stays comfortably under the 2000-char
 *               budget (`budget_exceeded` absent) — knobs are never
 *               decorative (AC-080-6).
 *
 * TG-25 (adr-tg-1 option b): the commands run IN-PROCESS through tests/helpers/run-lore-in-process.ts, not through
 * dist/lore. Wherever the prose above says the compiled binary is spawned or its freshness asserted, that is the
 * history of this file; the assertions and the throwaway-corpus rule are unchanged.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { runLoreInProcess } from "../helpers/run-lore-in-process";

// ─── Path / spawn setup ─────────────────────────────────────────────────────

// tests/e2e/ -> tests/ -> packages/lore/ -> packages/ -> repo root (4 levels up),
// mirrors tests/e2e/setup-freshness-cycle.bun.test.ts's own REPO_ROOT derivation
// (same directory, same depth).
const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** Spawns the COMPILED `dist/lore` binary with `cwd`/`HOME` both pointed at the throwaway corpus dir. `CLAUDECODE=1` resolves the "agent" caller surface (SPEC-024) so no create/handoff call risks a nested AI invocation even though every create below already passes `--no-ai` explicitly. */
async function runLore(args: string[], cwd: string): Promise<RunResult> {
  const proc = await runLoreInProcess(args, {
    cwd,
    home: cwd,
    env: { ...process.env, HOME: cwd, CLAUDECODE: "1" },
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

interface SeededCorpus {
  prdSlug: string;
  planASlug: string;
  planBSlug: string;
  planCSlug: string;
}

/**
 * Seeds the shared fixture described in this file's header: root PRD + 3
 * plans (2 actionable with 1 draft task each, 1 dead with zero tasks) + 1
 * handoff per actionable plan. Every `create` call is asserted `exitCode 0`
 * so a seeding failure fails loud at fixture-build time, never silently
 * producing an empty/partial corpus that the assertions below would then
 * misinterpret as "the projection dropped everything".
 */
async function seedCorpus(dir: string): Promise<SeededCorpus> {
  const prdResult = await runLore(
    ["create", "prd", "--title", "T6 Bootstrap Injection E2E PRD", "--content", "root", "--no-ai"],
    dir,
  );
  expect(prdResult.exitCode).toBe(0);
  const prdSlug = parseSlug(prdResult.stdout);

  const planAResult = await runLore(
    ["create", "plan", "--title", "Plan A actionable", "--parent", prdSlug, "--content", "x", "--no-ai"],
    dir,
  );
  expect(planAResult.exitCode).toBe(0);
  const planASlug = parseSlug(planAResult.stdout);

  const taskAResult = await runLore(
    [
      "create",
      "task",
      "--title",
      "Task A1",
      "--parent",
      planASlug,
      "--plan-id",
      planASlug,
      "--content",
      "x",
      "--no-ai",
    ],
    dir,
  );
  expect(taskAResult.exitCode).toBe(0);

  const planBResult = await runLore(
    ["create", "plan", "--title", "Plan B actionable", "--parent", prdSlug, "--content", "x", "--no-ai"],
    dir,
  );
  expect(planBResult.exitCode).toBe(0);
  const planBSlug = parseSlug(planBResult.stdout);

  const taskBResult = await runLore(
    [
      "create",
      "task",
      "--title",
      "Task B1",
      "--parent",
      planBSlug,
      "--plan-id",
      planBSlug,
      "--content",
      "x",
      "--no-ai",
    ],
    dir,
  );
  expect(taskBResult.exitCode).toBe(0);

  // Plan C: zero tasks -> ready:0, claimed:0 -> "dead", excluded from the
  // injection's active_plans regardless of max_active_plans (SPEC-080 D4).
  const planCResult = await runLore(
    ["create", "plan", "--title", "Plan C dead", "--parent", prdSlug, "--content", "x", "--no-ai"],
    dir,
  );
  expect(planCResult.exitCode).toBe(0);
  const planCSlug = parseSlug(planCResult.stdout);

  const handoffAResult = await runLore(
    ["handoff", "--plan", planASlug, "--next", "next step A", "--decision", "decision A@80"],
    dir,
  );
  expect(handoffAResult.exitCode).toBe(0);

  const handoffBResult = await runLore(
    ["handoff", "--plan", planBSlug, "--next", "next step B", "--decision", "decision B@70"],
    dir,
  );
  expect(handoffBResult.exitCode).toBe(0);

  return { prdSlug, planASlug, planBSlug, planCSlug };
}

/**
 * Plain `bootstrap --json`'s `data` payload — the untouched `BootstrapReport`
 * shape, REGRESSION-pinned as an exact 10-key set. `archive_candidates` (SPEC
 * spec-lifecycle-archival-plan-close-cascade-deterministic §Design Decisions
 * D4) is the newest, LAST-inserted key (`session-service.ts::bootstrap`'s own
 * `report` object literal appends it after `active_sessions`) — unlike the
 * INJECTION projection's present-iff-positive trim, the full report ALWAYS
 * carries this field as a plain required number (even `0`).
 */
const PLAIN_BOOTSTRAP_REPORT_KEYS = [
  "root",
  "active_plans",
  "pending_reviews",
  "my_claims",
  "armed_gates",
  "latest_handoffs",
  "resume_hint",
  "corpus",
  "active_sessions",
  "archive_candidates",
] as const;

describe("AC-080-3: compiled dist/lore bootstrap --injection / --json default-budget contract", () => {
  let dir: string;
  let seeded: SeededCorpus;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "lore-t6-bootstrap-injection-"));
    // Never the repo's own .lore/ corpus (project CLAUDE.md hard rule) — a
    // genuine os.tmpdir() path is never a prefix of REPO_ROOT.
    expect(dir.startsWith(REPO_ROOT)).toBe(false);
    await initCorpus(dir);
    seeded = await seedCorpus(dir);
  });

  afterAll(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  });

  it("REGRESSION: plain --json on the same corpus has exactly the literal 10-key BootstrapReport set", async () => {
    const result = await runLore(["bootstrap", "--json"], dir);
    expect(result.exitCode).toBe(0);

    const envelope = JSON.parse(result.stdout) as { ok: boolean; data: Record<string, unknown> };
    expect(envelope.ok).toBe(true);

    const keys = Object.keys(envelope.data);
    expect(keys).toHaveLength(10);
    expect(keys).toEqual([...PLAIN_BOOTSTRAP_REPORT_KEYS]);
    // Never touched by the injection projection: no condensed armed_gates
    // string[], no omitted ledger.
    expect(envelope.data["omitted"]).toBeUndefined();
    // AC-097-4: the FULL report always carries the field, even at `0` — the
    // present-iff-positive trim is an INJECTION-only behavior (buildBootstrapInjection),
    // never applied to the plain report itself.
    expect(envelope.data["archive_candidates"]).toBe(0);
  });

  it("NEGATIVE: --injectoin (typo) exits 2 (SPEC-051 strict-flags), never a silent no-op", async () => {
    const result = await runLore(["bootstrap", "--injectoin"], dir);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("Unknown option: --injectoin");
  });

  it("STATE: --injection --json combined takes --injection precedence — byte-identical output, never a rejection", async () => {
    const injectionOnly = await runLore(["bootstrap", "--injection"], dir);
    const combined = await runLore(["bootstrap", "--injection", "--json"], dir);

    expect(injectionOnly.exitCode).toBe(0);
    expect(combined.exitCode).toBe(0);
    expect(combined.stdout).toBe(injectionOnly.stdout);
  });

});

describe("AC-097-4: archive_candidates injection surfacing (spec-lifecycle-archival-plan-close-cascade-deterministic D4)", () => {
  let dir: string;
  let planSlug: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "lore-t6-archive-candidates-"));
    expect(dir.startsWith(REPO_ROOT)).toBe(false);
    await initCorpus(dir);

    // Disable plan-close so this fixture (out of THIS suite's scope — it's
    // about the INJECTION surfacing, not the gate) can archive a plan with
    // zero ceremony. APPENDS (never a wholesale overwrite, per the same
    // `bootstrap_injection` override two blocks above in this file): a
    // `writeFileSync` here would discard the `project:` block `initCorpus`
    // just wrote, failing `LoreConfigSchema` and silently reverting to
    // `rawConfig = undefined` — this file's own plan has no spec-tier
    // ancestor, so the archive currently succeeds regardless (the ONLY
    // plan-close predicate reachable there, the attestation floor, is
    // vacuous either way) — but that made the "disable" itself unverified,
    // exactly the defect class task-archive-sweep-gate-disable-is-silently-
    // inert-a-wholesale named. Appending is safe here because this is the
    // FIRST workflow override on this fixture's config. The `review` key empties judgment_required_types:
    // plans are judged by default (BR-281 / BR-1237) and this plan is approved only to be archived.
    const cfgPath = join(dir, ".lore", "config.yaml");
    const existing = readFileSync(cfgPath, "utf8");
    writeFileSync(cfgPath, `${existing}\nworkflow:\n  gates:\n    "plan-close":\n      enabled: false\n  review:\n    judgment_required_types: []\n`, "utf8");

    const prdResult = await runLore(["create", "prd", "--title", "Archive Candidates PRD", "--content", "root", "--no-ai"], dir);
    expect(prdResult.exitCode).toBe(0);
    const prdSlug = parseSlug(prdResult.stdout);

    const planResult = await runLore(
      ["create", "plan", "--title", "Archive Candidates Plan", "--parent", prdSlug, "--content", "x", "--no-ai"],
      dir,
    );
    expect(planResult.exitCode).toBe(0);
    planSlug = parseSlug(planResult.stdout);

    expect((await runLore(["set", planSlug, "--status", "approved"], dir)).exitCode).toBe(0);
    expect((await runLore(["set", planSlug, "--status", "archived"], dir)).exitCode).toBe(0);

    // Created AFTER the plan archived — a genuine R4 done_plan_straggler
    // candidate, never touched by the R1 cascade.
    const taskResult = await runLore(
      [
        "create",
        "task",
        "--title",
        "Injection Straggler Task",
        "--parent",
        planSlug,
        "--plan-id",
        planSlug,
        "--content",
        "x",
        "--no-ai",
      ],
      dir,
    );
    expect(taskResult.exitCode).toBe(0);
    // reason: the created slug is only used implicitly (it's what makes
    // archive_candidates positive) — no per-doc identity assertion needed
    // for this suite, which is scoped to the INJECTION SHAPE, not R4's own
    // rule-attribution (that's archive-candidates.test.ts's job).
    parseSlug(taskResult.stdout);
  });

  afterAll(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  });

  it("REGRESSION: plain --json also carries archive_candidates: 1 on the same corpus", async () => {
    const result = await runLore(["bootstrap", "--json"], dir);
    expect(result.exitCode).toBe(0);
    const envelope = JSON.parse(result.stdout) as { ok: boolean; data: Record<string, unknown> };
    expect(envelope.ok).toBe(true);
    expect(envelope.data["archive_candidates"]).toBe(1);
  });
});
