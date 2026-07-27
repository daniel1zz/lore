/**
 * @spec_ref SPEC-080 §Projection Contract, §Public Interface — task
 *   task-skill-test-t6-compiled-binary-e2e-injection-knobs-json-pin,
 *   AC-080-3, AC-080-6.
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
 * groups by parent plan and keeps only the newest per group). Nothing is
 * ever approved, so every one of the 8 created docs (prd + 3 plans + 2 tasks
 * + 2 handoffs) stays `status: "draft"` — a ready-made non-trivial pending
 * queue with zero extra authoring, closing this suite's "pending drafts"
 * seeding requirement for free.
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
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { assertFreshBinary } from "../integration/helpers/assert-fresh-binary";

// ─── Path / spawn setup ─────────────────────────────────────────────────────

// tests/e2e/ -> tests/ -> packages/lore/ -> packages/ -> repo root (4 levels up),
// mirrors tests/e2e/setup-freshness-cycle.bun.test.ts's own REPO_ROOT derivation
// (same directory, same depth).
const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const LORE_BIN = join(REPO_ROOT, "dist", "lore");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** Spawns the COMPILED `dist/lore` binary with `cwd`/`HOME` both pointed at the throwaway corpus dir. `CLAUDECODE=1` resolves the "agent" caller surface (SPEC-024) so no create/handoff call risks a nested AI invocation even though every create below already passes `--no-ai` explicitly. */
function runLore(args: string[], cwd: string): RunResult {
  const proc = Bun.spawnSync([LORE_BIN, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd, CLAUDECODE: "1" },
  });
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode ?? 1,
  };
}

function initCorpus(dir: string): void {
  const result = runLore(["init"], dir);
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
function seedCorpus(dir: string): SeededCorpus {
  const prdResult = runLore(
    ["create", "prd", "--title", "T6 Bootstrap Injection E2E PRD", "--content", "root", "--no-ai"],
    dir,
  );
  expect(prdResult.exitCode).toBe(0);
  const prdSlug = parseSlug(prdResult.stdout);

  const planAResult = runLore(
    ["create", "plan", "--title", "Plan A actionable", "--parent", prdSlug, "--content", "x", "--no-ai"],
    dir,
  );
  expect(planAResult.exitCode).toBe(0);
  const planASlug = parseSlug(planAResult.stdout);

  const taskAResult = runLore(
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

  const planBResult = runLore(
    ["create", "plan", "--title", "Plan B actionable", "--parent", prdSlug, "--content", "x", "--no-ai"],
    dir,
  );
  expect(planBResult.exitCode).toBe(0);
  const planBSlug = parseSlug(planBResult.stdout);

  const taskBResult = runLore(
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
  const planCResult = runLore(
    ["create", "plan", "--title", "Plan C dead", "--parent", prdSlug, "--content", "x", "--no-ai"],
    dir,
  );
  expect(planCResult.exitCode).toBe(0);
  const planCSlug = parseSlug(planCResult.stdout);

  const handoffAResult = runLore(
    ["handoff", "--plan", planASlug, "--by", "t6-tester", "--next", "next step A", "--decision", "decision A@80"],
    dir,
  );
  expect(handoffAResult.exitCode).toBe(0);

  const handoffBResult = runLore(
    ["handoff", "--plan", planBSlug, "--by", "t6-tester", "--next", "next step B", "--decision", "decision B@70"],
    dir,
  );
  expect(handoffBResult.exitCode).toBe(0);

  return { prdSlug, planASlug, planBSlug, planCSlug };
}

/**
 * The SPEC-080 §Projection Contract's literal field-order list for an
 * ORDINARY (non-seat-scoped) session — positions 1-8; `omitted` is always
 * the final key. `resume_hint` is ABSENT here (never present-as-null) per
 * spec-session-start-handoff-neutrality D1: the user is the router, an
 * ambient "resume this" guess misdirects every session but one in a
 * multi-session workflow.
 */
const INJECTION_CONTRACT_ORDER = [
  "my_claims",
  "active_sessions",
  "armed_gates",
  "root",
  "pending_reviews",
  "active_plans",
  "latest_handoffs",
  "corpus",
  "omitted",
] as const;

/**
 * The SAME contract, SEAT-SCOPED — `resume_hint` is retained at its
 * position-1 slot when `--seat-branch` resolves to a live plan
 * (spec-session-start-handoff-neutrality D2): that hint derives from the
 * session's own worktree branch, not a corpus-wide guess.
 */
const SEAT_SCOPED_INJECTION_CONTRACT_ORDER = [
  "resume_hint",
  ...INJECTION_CONTRACT_ORDER,
] as const;

/** Plain `bootstrap --json`'s `data` payload — the untouched `BootstrapReport` shape, REGRESSION-pinned as an exact 9-key set. */
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
] as const;

beforeAll(() => {
  assertFreshBinary(LORE_BIN, [
    join(REPO_ROOT, "packages", "lore", "src"),
    join(REPO_ROOT, "packages", "core", "src"),
  ]);
});

describe("AC-080-3: compiled dist/lore bootstrap --injection / --json default-budget contract", () => {
  let dir: string;
  let seeded: SeededCorpus;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "lore-t6-bootstrap-injection-"));
    // Never the repo's own .lore/ corpus (project CLAUDE.md hard rule) — a
    // genuine os.tmpdir() path is never a prefix of REPO_ROOT.
    expect(dir.startsWith(REPO_ROOT)).toBe(false);
    initCorpus(dir);
    seeded = seedCorpus(dir);
  });

  afterAll(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  });

  it("HAPPY: --injection prints compact JSON in literal contract key order with the omitted ledger, dead plan excluded", () => {
    const result = runLore(["bootstrap", "--injection"], dir);
    expect(result.exitCode).toBe(0);

    const raw = result.stdout.trim();
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    // Compact serialization: re-stringifying the parsed object with no
    // indentation reproduces the exact stdout string — proves both "no
    // pretty-printing whitespace" AND "key order is preserved end to end"
    // in one assertion (JS objects/JSON.stringify iterate string keys in
    // insertion order).
    expect(JSON.stringify(parsed)).toBe(raw);
    expect(raw).not.toContain("\n  ");
    expect(raw).not.toContain("\n");

    expect(Object.keys(parsed)).toEqual([...INJECTION_CONTRACT_ORDER]);

    // NEGATIVE (spec-session-start-handoff-neutrality D1): an ordinary
    // (no --seat-branch) session's injection carries ZERO resume_hint keys —
    // never present, not even as null. Checked both structurally
    // (Object.keys/hasOwnProperty) and textually (raw stdout) so a
    // regression can't slip through via a differently-cased or
    // differently-nested reintroduction.
    expect(parsed).not.toHaveProperty("resume_hint");
    expect(raw).not.toContain("resume_hint");

    const activePlans = parsed["active_plans"] as Array<{ slug: string }>;
    const activePlanSlugs = activePlans.map((p) => p.slug);
    expect(activePlanSlugs).toContain("plan-a-actionable");
    expect(activePlanSlugs).toContain("plan-b-actionable");
    expect(activePlanSlugs).not.toContain("plan-c-dead");

    // Single typed omission ledger (SPEC-080 D2) — default budgets (5/3/3/8000)
    // never cap either actionable plan or handoff below what's kept, but
    // active_plans folds in the dead-plan exclusion (3 total active plans -
    // 2 kept actionable ones = 1) and pending_slugs caps the 8 draft docs
    // down to the default max_pending_slugs=3 (5 dropped) — both per
    // buildBootstrapInjection's documented single-formula omission math.
    expect(parsed["omitted"]).toEqual({
      active_plans: 1,
      latest_handoffs: 0,
      pending_slugs: 5,
      budget_drops: 0,
    });
    expect(parsed["budget_exceeded"]).toBeUndefined();
  });

  it("REGRESSION: plain --json on the same corpus has exactly the literal 9-key BootstrapReport set", () => {
    const result = runLore(["bootstrap", "--json"], dir);
    expect(result.exitCode).toBe(0);

    const envelope = JSON.parse(result.stdout) as { ok: boolean; data: Record<string, unknown> };
    expect(envelope.ok).toBe(true);

    const keys = Object.keys(envelope.data);
    expect(keys).toHaveLength(9);
    expect(keys).toEqual([...PLAIN_BOOTSTRAP_REPORT_KEYS]);
    // Never touched by the injection projection: no condensed armed_gates
    // string[], no omitted ledger.
    expect(envelope.data["omitted"]).toBeUndefined();
  });

  it("NEGATIVE: --injectoin (typo) exits 2 (SPEC-051 strict-flags), never a silent no-op", () => {
    const result = runLore(["bootstrap", "--injectoin"], dir);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("Unknown option: --injectoin");
  });

  it("STATE: --injection --json combined takes --injection precedence — byte-identical output, never a rejection", () => {
    const injectionOnly = runLore(["bootstrap", "--injection"], dir);
    const combined = runLore(["bootstrap", "--injection", "--json"], dir);

    expect(injectionOnly.exitCode).toBe(0);
    expect(combined.exitCode).toBe(0);
    expect(combined.stdout).toBe(injectionOnly.stdout);
  });

  it("HAPPY: a --seat-branch that resolves to a live plan retains resume_hint at its contract position-1 slot, scoped to that plan's own newest handoff (spec-session-start-handoff-neutrality D2)", () => {
    const shortSlug = seeded.planASlug.replace(/^plan-/, "");
    const result = runLore(["bootstrap", "--injection", "--seat-branch", `plan/${shortSlug}`], dir);
    expect(result.exitCode).toBe(0);

    const raw = result.stdout.trim();
    const parsed = JSON.parse(raw) as { resume_hint?: { plan_slug: string | null; handoff_slug: string } };

    expect(Object.keys(parsed)).toEqual([...SEAT_SCOPED_INJECTION_CONTRACT_ORDER]);
    expect(parsed.resume_hint).toBeDefined();
    // reason: the seat's OWN plan (Plan A) has its own handoff — a
    // wrongly-unscoped implementation would instead surface the
    // corpus-global newest handoff, which per the fixture's HandoffB write
    // order (written after HandoffA in seedCorpus) would belong to Plan B —
    // the exact failure mode this assertion is designed to catch.
    expect(parsed.resume_hint?.plan_slug).toBe(seeded.planASlug);
  });

  it("NEGATIVE: an unresolvable --seat-branch (no matching plan) is treated as ordinary — resume_hint is still absent from the injection", () => {
    const result = runLore(
      ["bootstrap", "--injection", "--seat-branch", "plan/nonexistent-slug-xyz"],
      dir,
    );
    expect(result.exitCode).toBe(0);

    const raw = result.stdout.trim();
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    // reason: an unresolvable seat branch also sets `seat_unresolved: true`
    // on the report (SPEC-057 D3), which reaches the injection via the D8
    // OCP unknown-field mechanism, appended between corpus and omitted — a
    // SEPARATE, already-covered contract concern (SPEC-080), not something
    // this D1/D2 case re-pins. Filtering it out isolates the assertion this
    // test actually owns: resume_hint's absence.
    const { seat_unresolved: _seatUnresolved, ...withoutSeatUnresolved } = parsed;
    expect(Object.keys(withoutSeatUnresolved)).toEqual([...INJECTION_CONTRACT_ORDER]);
    expect(parsed).not.toHaveProperty("resume_hint");
    expect(parsed["seat_unresolved"]).toBe(true);
  });
});

describe("AC-080-6: workflow.bootstrap_injection config knobs reach the projection end-to-end", () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "lore-t6-bootstrap-injection-knobs-"));
    expect(dir.startsWith(REPO_ROOT)).toBe(false);
    initCorpus(dir);
    seedCorpus(dir);

    const cfgPath = join(dir, ".lore", "config.yaml");
    const existing = readFileSync(cfgPath, "utf8");
    const override =
      "\nworkflow:\n  bootstrap_injection:\n    max_active_plans: 1\n    max_handoffs: 1\n" +
      "    max_pending_slugs: 1\n    char_budget: 2000\n";
    writeFileSync(cfgPath, existing + override, "utf8");
  });

  afterAll(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  });

  it("BOUNDARY: non-default max_active_plans/max_handoffs/max_pending_slugs/char_budget are never decorative", () => {
    const result = runLore(["bootstrap", "--injection"], dir);
    expect(result.exitCode).toBe(0);

    const parsed = JSON.parse(result.stdout.trim()) as {
      active_plans: unknown[];
      latest_handoffs: unknown[];
      pending_reviews: { count: number; slugs: string[] };
      omitted: { active_plans: number; latest_handoffs: number; pending_slugs: number; budget_drops: number };
      budget_exceeded?: true;
    };

    // max_active_plans: 1 — exactly 1 of the 2 actionable plans kept; the
    // dead plan (never actionable) plus the 1 dropped actionable plan fold
    // into one omitted count (3 total active plans - 1 kept = 2).
    expect(parsed.active_plans).toHaveLength(1);
    expect(parsed.omitted.active_plans).toBe(2);

    // max_handoffs: 1 — 1 of the 2 per-plan handoff groups kept.
    expect(parsed.latest_handoffs).toHaveLength(1);
    expect(parsed.omitted.latest_handoffs).toBe(1);

    // max_pending_slugs: 1 — sample capped to 1, true queue size (8 draft
    // docs: prd + 3 plans + 2 tasks + 2 handoffs) untouched in `count`.
    expect(parsed.pending_reviews.slugs).toHaveLength(1);
    expect(parsed.pending_reviews.count).toBe(8);
    expect(parsed.omitted.pending_slugs).toBe(7);

    // char_budget: 2000 — this fixture's capped payload is well under 2000
    // chars, so the budget rule never needs to drop a whole entry.
    expect(result.stdout.trim().length).toBeLessThanOrEqual(2000);
    expect(parsed.omitted.budget_drops).toBe(0);
    expect(parsed.budget_exceeded).toBeUndefined();
  });
});
