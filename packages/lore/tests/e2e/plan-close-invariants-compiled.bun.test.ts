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
 * Config: `workflow.gates."plan-close".prd_sync.enabled: true`, NO
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
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { saveConfig } from "@lore/core/node";
import type { LoreConfig } from "@lore/core";
import { assertFreshBinary } from "../integration/helpers/assert-fresh-binary";

// ─── Path / spawn setup ─────────────────────────────────────────────────────

// tests/e2e/ -> tests/ -> packages/lore/ -> packages/ -> repo root (4 levels up),
// mirrors every sibling compiled-binary e2e suite's own REPO_ROOT derivation.
const REPO_ROOT = new URL("../../../../", import.meta.url).pathname.replace(/\/$/, "");
const LORE_BIN = join(REPO_ROOT, "dist", "lore");

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
function runLore(args: string[], cwd: string, envOverrides: Record<string, string> = {}): RunResult {
  const proc = Bun.spawnSync([LORE_BIN, ...args], {
    cwd,
    env: {
      ...process.env,
      HOME: cwd,
      CLAUDECODE: "1",
      LORE_ACTOR: "agent:t5-pci12-probe",
      ...envOverrides,
    },
  });
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode ?? 1,
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

beforeAll(() => {
  assertFreshBinary(LORE_BIN, [
    join(REPO_ROOT, "packages", "lore", "src"),
    join(REPO_ROOT, "packages", "core", "src"),
  ]);
});

afterAll(() => {
  cleanupAll();
});

// ─── Corpus-building helpers ────────────────────────────────────────────────

/**
 * Writes `.lore/config.yaml` — `prd_sync` ON, NO `workflow.attestation
 * .min_ratio` key at all (§D4: absent means `resolveAttestationMinRatio` ===
 * null, the ratio conjunct never runs — the per-claimed-AC coverage conjunct
 * is the only thing this suite is proving), and
 * `review.judgment_required_types: []` (neutralizes the unrelated SPEC-103
 * gate on the spec approval below).
 */
function writeConfig(dir: string): void {
  const config: LoreConfig = {
    project: { name: "t5-pci12-compiled-e2e", author: "t5-tester" },
    workflow: {
      gates: { "plan-close": { prd_sync: { enabled: true } } },
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
      gates: { "plan-close": { prd_sync: { enabled: true } } },
      review: { judgment_required_types: [] },
      attestation: { min_ratio: minRatio },
    },
  } as unknown as LoreConfig;
  const result = saveConfig(dir, config);
  if (!result.ok) {
    throw new Error(`saveConfig (ratio floor) failed: ${JSON.stringify(result.error)}`);
  }
}

function initCorpus(dir: string): void {
  const initResult = runLore(["init"], dir);
  if (initResult.exitCode !== 0) {
    throw new Error(`lore init failed: ${initResult.stderr}`);
  }
  writeConfig(dir);
}

function createPrd(dir: string, title: string): string {
  const r = runLore(["create", "prd", "--title", title, "--content", "# PRD\n\nroot.", "--no-ai"], dir);
  if (r.exitCode !== 0) throw new Error(`create prd failed: ${r.stderr}`);
  return parseSlug(r.stdout);
}

/** Parented DIRECTLY under the PRD — no `implements` edge declared anywhere,
 *  so `resolvePrdSyncDomainDoc` resolves NO domain doc for this spec (§D6). */
function createSpec(dir: string, prdSlug: string, title: string): string {
  const r = runLore(
    ["create", "spec", "--title", title, "--parent", prdSlug, "--content", "## Overview\n\nBody.", "--no-ai"],
    dir,
  );
  if (r.exitCode !== 0) throw new Error(`create spec failed: ${r.stderr}`);
  return parseSlug(r.stdout);
}

function addScriptAc(dir: string, specSlug: string, acId: string, command: string): void {
  const r = runLore(
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

function createPlan(dir: string, specSlug: string, title: string): string {
  const r = runLore(
    ["create", "plan", "--title", title, "--parent", specSlug, "--content", "## Plan\n\nbody", "--no-ai"],
    dir,
  );
  if (r.exitCode !== 0) throw new Error(`create plan failed: ${r.stderr}`);
  return parseSlug(r.stdout);
}

function createTask(dir: string, planSlug: string, title: string): string {
  const r = runLore(
    [
      "create",
      "task",
      "--title",
      title,
      "--plan-id",
      planSlug,
      "--content",
      "## Task\n\nbody",
      "--no-ai",
    ],
    dir,
  );
  if (r.exitCode !== 0) throw new Error(`create task failed: ${r.stderr}`);
  return parseSlug(r.stdout);
}

/** Records ATTESTED evidence via the trusted-runner path (SPEC-039) — the ONLY
 *  legitimate producer of an `attestation`-bearing entry; never hand-crafted. */
function verifyAttested(dir: string, planSlug: string, taskSlug: string, acId: string): RunResult {
  return runLore(["verify", planSlug, "--task", taskSlug, "--ac", acId, "--allow-new-commands"], dir);
}

/** Records SELF-REPORTED (never attested) evidence via `lore evidence`. */
function evidenceSelfReported(dir: string, taskSlug: string, acId: string, command: string): RunResult {
  return runLore(
    ["evidence", taskSlug, "--oracle", "other", "--command", command, "--result", "pass", "--ac", acId],
    dir,
  );
}

function approvePlan(dir: string, planSlug: string): RunResult {
  return runLore(["approve", planSlug], dir);
}

function archivePlan(dir: string, planSlug: string): RunResult {
  return runLore(["set", planSlug, "--status", "archived"], dir);
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describe("AC-PCI-12: compiled close — throwaway corpus, dist/lore binary, one PRD -> spec -> two sibling plans", () => {
  let dir: string;
  let specSlug: string;

  beforeAll(() => {
    dir = trackDir(mkdtempSync(join(tmpdir(), "lore-t5-pci12-")));
    expect(dir.startsWith(REPO_ROOT)).toBe(false);
    initCorpus(dir);

    const prdSlug = createPrd(dir, "T5 PCI-12 Root PRD");
    // Parented directly under the PRD (never under another spec) — the
    // fixture shape that leaves `resolvePrdSyncDomainDoc` resolving nothing.
    specSlug = createSpec(dir, prdSlug, "T5 PCI-12 Governing Spec (no domain doc)");
    addScriptAc(dir, specSlug, AC_ID, AC_COMMAND);

    const approveSpec = runLore(["approve", specSlug], dir);
    if (approveSpec.exitCode !== 0) {
      throw new Error(`approve spec failed (setup): ${approveSpec.stderr}`);
    }
  });

  it("compiled close — scenario A: an attested single-claimed-AC plan archives at exit 0, with the not-applicable advisory genuinely printed (never a silent vacuous pass)", () => {
    const planSlug = createPlan(dir, specSlug, "T5 PCI-12 Plan A (clean close)");
    const taskSlug = createTask(dir, planSlug, "T5 PCI-12 Task A");

    // Attested evidence for the claimed AC, via the trusted runner — never
    // hand-crafted.
    const verifyResult = verifyAttested(dir, planSlug, taskSlug, AC_ID);
    expect(verifyResult.exitCode).toBe(0);
    expect(verifyResult.stdout).toContain(AC_ID);

    // `lore approve <plan>` is where §D2's "loud on two channels" becomes
    // OBSERVABLE from this CLI surface: the plan-promote early-warning
    // advisory, naming the ancestor spec and the wiring command, on stderr —
    // never stdout (D1: an advisory never changes the outcome; exit stays 0
    // whether or not it prints). A test that skipped this assertion and only
    // checked the final archive's exit code would let a silently-swallowed
    // advisory pass unnoticed — exactly the vacuous-pass defect class §D2
    // fixes.
    const approveResult = approvePlan(dir, planSlug);
    expect(approveResult.exitCode).toBe(0);
    expect(approveResult.stderr).toContain("prd-sync predicate");
    expect(approveResult.stderr).toContain("NOT-APPLICABLE");
    expect(approveResult.stderr).toContain(specSlug);
    expect(approveResult.stderr).toContain("lore link");
    expect(approveResult.stderr).toContain("--type implements");
    // Channel discipline — the advisory never leaks to stdout.
    expect(approveResult.stdout).not.toContain("NOT-APPLICABLE");
    expect(approveResult.stdout).not.toContain("ADVISORY");

    // Archive: every claimed AC attested, no `min_ratio` configured, domain
    // doc absent (not-applicable, never a violation) — clean close, exit 0,
    // no exemption field needed anywhere.
    const archiveResult = archivePlan(dir, planSlug);
    expect(archiveResult.exitCode).toBe(0);
    expect(archiveResult.stderr).not.toContain("attestation-floor");
  });

  // REWRITTEN (spec-declared-scope-attestation-contract-task-owned-ac-scope
  // §Facts D4/D5) — this scenario used to pin "an unattested EXERCISED AC blocks".
  // D4 retired that conjunct: the audited evidence was defining its own audit
  // scope, so the coverage conjunct now reads the DECLARED scope
  // (`task.extra.ac_scope`) and reports `notApplicable(scope-undeclared)` when no
  // evidence-bearing task declared one. The scenario keeps its SHAPE (a RED half
  // and a control proving the right cause) against the conjunct that still blocks
  // from a pure-CLI fixture: the opt-in ratio. It cannot yet author `ac_scope`
  // through the compiled binary — `lore scope add` / `lore create task --ac-scope`
  // is a SIBLING task of this same spec; a compiled-binary oracle for the declared
  // conjunct belongs with that writer, not here.
  it("compiled close — scenario B: an undeclared-scope plan is NOT blocked by its unattested exercised AC (D4), while an explicitly configured ratio floor still blocks the SAME command until evidence is attested (control proving the RIGHT cause)", () => {
    const planSlug = createPlan(dir, specSlug, "T5 PCI-12 Plan B (undeclared scope)");
    const taskSlug = createTask(dir, planSlug, "T5 PCI-12 Task B");

    // Self-reported ONLY, and NO `ac_scope` declared on the task — the legacy
    // shape every pre-`lore scope add` corpus has.
    const evidenceResult = evidenceSelfReported(dir, taskSlug, AC_ID, AC_COMMAND);
    expect(evidenceResult.exitCode).toBe(0);

    const approveResult = approvePlan(dir, planSlug);
    expect(approveResult.exitCode).toBe(0);

    // D4 — the coverage conjunct has no CLAIM to audit, so it reports
    // not-applicable and the close proceeds. Deliberate and retroactive: arming a
    // declared-scope conjunct must not retroactively deny every plan authored
    // before the field existed.
    const undeclaredResult = archivePlan(dir, planSlug);
    expect(undeclaredResult.exitCode).toBe(0);
    expect(undeclaredResult.stderr).not.toContain("gate:plan-close:attestation-floor");

    // CONTROL — the floor still has teeth through the compiled artifact. A THIRD
    // sibling plan, same corpus, with `workflow.attestation.min_ratio` now
    // explicitly configured: the identical `lore set … --status archived` command
    // is DENIED at exit 4 naming the attestation-floor field, and the denial
    // disappears once the SAME task's evidence carries a runner attestation. Two
    // runs of one command differing only in that fact prove the block's cause.
    writeConfigWithRatioFloor(dir, 0.5);
    const controlPlanSlug = createPlan(dir, specSlug, "T5 PCI-12 Plan C (ratio floor)");
    const controlTaskSlug = createTask(dir, controlPlanSlug, "T5 PCI-12 Task C");
    expect(evidenceSelfReported(dir, controlTaskSlug, AC_ID, AC_COMMAND).exitCode).toBe(0);
    expect(approvePlan(dir, controlPlanSlug).exitCode).toBe(0);

    const blockedResult = archivePlan(dir, controlPlanSlug);
    expect(blockedResult.exitCode).toBe(4);
    expect(blockedResult.stderr).toContain("gate:plan-close:attestation-floor");
    expect(blockedResult.stderr).toContain("lore verify");

    const verifyResult = verifyAttested(dir, controlPlanSlug, controlTaskSlug, AC_ID);
    expect(verifyResult.exitCode).toBe(0);

    const unblockedResult = archivePlan(dir, controlPlanSlug);
    expect(unblockedResult.exitCode).toBe(0);
    expect(unblockedResult.stderr).not.toContain("attestation-floor");
  });
});
