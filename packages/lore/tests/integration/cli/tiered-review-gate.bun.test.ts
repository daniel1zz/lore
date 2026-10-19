// @reads assets/project/lore-config-template.yaml
// @reads assets/governance/write-spec-rule.md
/**
 * SPEC-103 §Mechanisms M2/M3 — judgment-required promote (anti-lottery worst-
 * decision-wins, `--override-judgment`/`--override-no-judgment` audited escapes) +
 * ledger backfill, exercised end-to-end against the COMPILED `dist/lore` binary
 * (`Bun.spawnSync`) over a THROWAWAY corpus created via `mkdtemp(os.tmpdir())` —
 * genuinely outside this repo's own working tree, never touching the repo's own
 * `.lore/` corpus (project CLAUDE.md hard rule). Requires `bun run build` to have
 * run first — `assertFreshBinary` fails loud before any test runs otherwise.
 *
 * Judgment rows are seeded via a DIRECT `bun:sqlite` insert into `review_judgments`
 * (mirrors `trace-stats.bun.test.ts`'s `insertRawTraceRow` precedent) rather than
 * through a real `lore review <doc>` AI-judge call — there is no scripted-success
 * stub-claude shim in this repo (`stub-claude.ts` is fail-FAST only, designed to
 * prove the real AI binary is never reached), and seeding a real judgment row is
 * the ACTUAL fact `approve()`'s gate reads, not an approximation of it.
 *
 * Six-dimension coverage:
 *   HAPPY:      AC-TIER-4 — approve after a fresh approve-judgment for the current
 *               version succeeds; AC-TIER-8 — backfill fast-tracks existing draft
 *               ledger docs
 *   NEGATIVE:   AC-TIER-4 — approve with zero judgments for the current version
 *               denies (exit 4), stderr names `lore review`
 *   BOUNDARY:   AC-TIER-8 — a second backfill run is a no-op (zero fast_tracked)
 *   ERROR:      `--override-judgment` with a non-existent judgment id (implicit —
 *               covered by the same VALIDATION_ERROR path AC-TIER-5's happy override
 *               exercises the success side of); `--override-no-judgment` rejected loud
 *               when the doc already has a judgment (points the caller at
 *               `--override-judgment` instead — task-t3-hardening)
 *   STATE:      AC-TIER-5 — a reject judgment on version N cannot be outrolled by a
 *               LATER approve-judgment on that SAME version (worst-decision-wins);
 *               only a version bump + fresh approve-judgment unlocks
 *   REGRESSION: AC-TIER-5 — `--override-judgment` approves despite the blocking
 *               reject, with an audit row recording the overridden judgment id;
 *               `--override-no-judgment` approves a NEVER-judged doc (the NO_JUDGMENT
 *               denial `--override-judgment` cannot reach — task-t3-hardening) with an
 *               audit row recording `override_no_judgment: true`
 *
 * @spec_ref SPEC-103 §Acceptance Criteria AC-TIER-4, AC-TIER-5, AC-TIER-8
 *
 * TG-25 (adr-tg-1 option b): the commands run IN-PROCESS through tests/helpers/run-lore-in-process.ts, not through
 * dist/lore. Wherever the prose above says the compiled binary is spawned or its freshness asserted, that is the
 * history of this file; the assertions and the throwaway-corpus rule are unchanged.
 */

import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { citeSpecViaAsyncCli, asyncLoreRunnerFor } from "../../helpers/cli-live-rule.js";
import { runLoreInProcess } from "../../helpers/run-lore-in-process";
import { loosenOverrideClasses } from "../fixtures/autonomy-override-helpers.js";
import { patchLoreConfig } from "../../helpers/patch-lore-config.js";

// tests/integration/cli/ -> tests/integration/ -> tests/ -> packages/lore/ -> packages/ -> repo root (5 up).
const REPO_ROOT = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/**
 * Spawns the compiled `dist/lore` binary with `cwd` as its working directory.
 * `stdin: "ignore"` — none of these invocations ever need stdin input (no
 * `--refine-stdin` calls in this suite); explicit, never inherited from the test
 * runner's own stdin, which can otherwise leave a spawned child blocked on a
 * read that never resolves.
 */
async function runLore(args: string[], cwd: string): Promise<RunResult> {
  const proc = await runLoreInProcess(args, {
    cwd,
    home: cwd,
    env: { ...process.env, HOME: cwd, EDITOR: "true", CLAUDECODE: "1" },
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

interface JsonEnvelope<T> {
  ok: boolean;
  data: T;
}

interface DocEnvelope {
  id: string;
  slug: string;
  version: number;
  status: string;
}

async function createPrd(dir: string): Promise<DocEnvelope> {
  const result = await runLore(["create", "prd", "--title", "Root PRD", "--content", "x", "--json"], dir);
  if (result.exitCode !== 0) {
    throw new Error(`lore create prd failed: ${result.stderr}`);
  }
  return (JSON.parse(result.stdout) as JsonEnvelope<DocEnvelope>).data;
}

/**
 * Creates a spec with one declared script-mode AC (satisfies spec-promote's own
 * floor, isolating the judgment-required gate's own denial from a pre-existing
 * AC-count gate).
 *
 * @returns The doc as it stands AFTER `lore ac add` — `AcService.addCriterion`
 *   itself bumps the doc's version (a `set()` write persisting the new
 *   `extra.acceptance_criteria` array), so the id/slug/version the CALLER needs
 *   for judgment-seeding is this POST-ac-add snapshot, never the pre-ac-add
 *   create() response (whose `version: 1` is already stale by the time a
 *   judgment gets seeded against it).
 */
async function createSpecWithAc(dir: string, parentSlug: string, title: string): Promise<DocEnvelope> {
  const createResult = await runLore(
    ["create", "spec", "--title", title,"--content", "## Overview\n\nBody.", "--json"],
    dir,
  );
  if (createResult.exitCode !== 0) {
    throw new Error(`lore create spec failed: ${createResult.stderr}`);
  }
  const created = (JSON.parse(createResult.stdout) as JsonEnvelope<DocEnvelope>).data;
  const acResult = await runLore(
    [
      "ac",
      "add",
      created.slug,
      "AC-1",
      "--statement",
      "the parser round-trips every fixture file",
      "--mode",
      "script",
      "--oracle",
      "test",
      "--command",
      "true",
    ],
    dir,
  );
  if (acResult.exitCode !== 0) {
    throw new Error(`lore ac add failed: ${acResult.stderr}`);
  }
  // BR-1007: the criterion cites a live rule, so the spec is approvable once its judgment gate passes.
  // The cite bumps the version, so the snapshot below (the version judgments are seeded against) is read AFTER it.
  await citeSpecViaAsyncCli(asyncLoreRunnerFor(runLore, dir), dir, undefined, created.slug, "AC-1");
  return await getDoc(dir, created.slug);
}

async function getDoc(dir: string, idOrSlug: string): Promise<DocEnvelope> {
  const result = await runLore(["get", idOrSlug, "--json"], dir);
  if (result.exitCode !== 0) {
    throw new Error(`lore get failed: ${result.stderr}`);
  }
  return (JSON.parse(result.stdout) as JsonEnvelope<{ doc: DocEnvelope }>).data.doc;
}

let seedCounter = 0;

/**
 * Direct `bun:sqlite` insert into `review_judgments` (migration-003.ts schema) — the
 * ACTUAL fact `ReviewService.approve`'s `review-judgment` checkpoint reads, seeded
 * without invoking a real AI provider (no scripted-success stub-claude shim exists
 * in this repo — `stub-claude.ts` is fail-fast only).
 */
function insertRawJudgment(
  dbDir: string,
  opts: {
    docId: string;
    docVersion: number;
    decision: "approve" | "reject" | "escalate";
    judgeProvider?: string;
    judgeModel?: string;
    judgePromptVersion?: string;
  },
): string {
  const id = `judgment-seed-${++seedCounter}`;
  const db = new Database(join(dbDir, ".lore", "lore.db"));
  try {
    db.run(
      `INSERT INTO review_judgments
        (id, doc_id, doc_version, decision, confidence, reasons, checks, blocking_questions,
         judge_provider, judge_model, judge_prompt_version, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        opts.docId,
        opts.docVersion,
        opts.decision,
        0.9,
        JSON.stringify([{ dimension: "completeness", finding: "seeded for test" }]),
        JSON.stringify([{ check: "schema", outcome: "pass" }]),
        JSON.stringify(opts.decision === "escalate" ? ["seeded blocking question"] : []),
        opts.judgeProvider ?? "test-judge",
        opts.judgeModel ?? "test-model",
        opts.judgePromptVersion ?? "v1",
        new Date().toISOString(),
        "ai:test-judge:test-model:v1",
      ],
    );
  } finally {
    db.close();
  }
  return id;
}

/** Reads the most recent `action='approve'` audit row's `details` for `docId`. */
function latestApproveAuditDetails(dbDir: string, docId: string): Record<string, unknown> {
  const db = new Database(join(dbDir, ".lore", "lore.db"), { readonly: true });
  try {
    const row = db
      .query("SELECT details FROM audit WHERE doc_id = ? AND action = 'approve' ORDER BY id DESC LIMIT 1")
      .get(docId) as { details: string } | null;
    if (row === null) throw new Error(`no approve audit row found for doc ${docId}`);
    return JSON.parse(row.details) as Record<string, unknown>;
  } finally {
    db.close();
  }
}

let tmpDir: string;

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

// ─── AC-TIER-4: judgment-required gate ────────────────────────────────────────

describe("AC-TIER-4 judgment gate", () => {
  it("approve of a spec with zero judgments for the current version exits 4 naming lore review", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "lore-tiered-review-ac4-"));
    await initCorpus(tmpDir);
    const prd = await createPrd(tmpDir);
    const spec = await createSpecWithAc(tmpDir, prd.slug, "Spec Needing Judgment");

    const result = await runLore(["approve", spec.slug], tmpDir);
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain("lore review");

    const doc = await getDoc(tmpDir, spec.slug);
    expect(doc.status).toBe("draft");
  });

  it("after a fresh approve-judgment for the current version, approve succeeds", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "lore-tiered-review-ac4b-"));
    await initCorpus(tmpDir);
    const prd = await createPrd(tmpDir);
    const spec = await createSpecWithAc(tmpDir, prd.slug, "Spec With Fresh Judgment");

    insertRawJudgment(tmpDir, { docId: spec.id, docVersion: spec.version, decision: "approve" });

    const result = await runLore(["approve", spec.slug], tmpDir);
    expect(result.exitCode).toBe(0);

    const doc = await getDoc(tmpDir, spec.slug);
    expect(doc.status).toBe("approved");
  });
});

// ─── AC-TIER-5: anti-lottery worst-decision-wins + --override-judgment ────────

describe("AC-TIER-5 anti-lottery worst-decision-wins", () => {
  it("a reject judgment on version N cannot be outrolled by a later approve-judgment on version N", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "lore-tiered-review-ac5-"));
    await initCorpus(tmpDir);
    const prd = await createPrd(tmpDir);
    const spec = await createSpecWithAc(tmpDir, prd.slug, "Spec With Reject Then Approve");

    insertRawJudgment(tmpDir, { docId: spec.id, docVersion: spec.version, decision: "reject" });

    const firstAttempt = await runLore(["approve", spec.slug], tmpDir);
    expect(firstAttempt.exitCode).toBe(4);

    // A LATER approve-judgment on the SAME version — must NOT outroll the reject.
    insertRawJudgment(tmpDir, { docId: spec.id, docVersion: spec.version, decision: "approve" });

    const secondAttempt = await runLore(["approve", spec.slug], tmpDir);
    expect(secondAttempt.exitCode).toBe(4);

    const doc = await getDoc(tmpDir, spec.slug);
    expect(doc.status).toBe("draft");
  });

  it("version bump + fresh approve-judgment approves", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "lore-tiered-review-ac5b-"));
    await initCorpus(tmpDir);
    const prd = await createPrd(tmpDir);
    const spec = await createSpecWithAc(tmpDir, prd.slug, "Spec Unlocked By Version Bump");

    insertRawJudgment(tmpDir, { docId: spec.id, docVersion: spec.version, decision: "reject" });
    const blocked = await runLore(["approve", spec.slug], tmpDir);
    expect(blocked.exitCode).toBe(4);

    // Version bump (still draft — the reject blocked promotion, so this is a normal
    // draft content edit, not the approved->draft reset path).
    const editResult = await runLore(["set", spec.slug, "--content", "## Overview\n\nUpdated body."], tmpDir);
    expect(editResult.exitCode).toBe(0);
    const editedDoc = await getDoc(tmpDir, spec.slug);
    expect(editedDoc.version).toBeGreaterThan(spec.version);

    insertRawJudgment(tmpDir, { docId: spec.id, docVersion: editedDoc.version, decision: "approve" });
    const unlocked = await runLore(["approve", spec.slug], tmpDir);
    expect(unlocked.exitCode).toBe(0);

    const finalDoc = await getDoc(tmpDir, spec.slug);
    expect(finalDoc.status).toBe("approved");
  });

  it("--override-judgment approves with an audit row recording the overridden judgment id", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "lore-tiered-review-ac5c-"));
    await initCorpus(tmpDir);
    // AU-T7: the override is decided; this test's subject is the audited escape, so the class is loosened the
    // documented way (human-tty governance decision), never by a bypass in product code.
    await loosenOverrideClasses(tmpDir, ["override-judgment"]);
    const prd = await createPrd(tmpDir);
    const spec = await createSpecWithAc(tmpDir, prd.slug, "Spec Overridden");

    const rejectJudgmentId = insertRawJudgment(tmpDir, {
      docId: spec.id,
      docVersion: spec.version,
      decision: "reject",
    });

    const blocked = await runLore(["approve", spec.slug], tmpDir);
    expect(blocked.exitCode).toBe(4);

    const overridden = await runLore(["approve", spec.slug, "--override-judgment", rejectJudgmentId], tmpDir);
    expect(overridden.exitCode).toBe(0);

    const doc = await getDoc(tmpDir, spec.slug);
    expect(doc.status).toBe("approved");

    const auditDetails = latestApproveAuditDetails(tmpDir, spec.id);
    expect(auditDetails["override_judgment_id"]).toBe(rejectJudgmentId);
  });

  // task-t3-hardening-reachable-override-escape-real-ai-provenance — `--override-judgment`
  // requires an id resolving to an EXISTING review_judgments row; a doc that has NEVER been
  // judged has no id anywhere to supply, so the escape hatch was structurally unreachable for
  // the most common denial (NO_JUDGMENT, exercised by AC-TIER-4's own first test). This proves
  // the sibling `--override-no-judgment` flag reaches it instead.
  it("--override-no-judgment approves a doc that has never been judged, with an audit row recording it", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "lore-tiered-review-ac5d-"));
    await initCorpus(tmpDir);
    // AU-T7: the override is decided; this test's subject is the audited escape, so the class is loosened the
    // documented way (human-tty governance decision), never by a bypass in product code.
    await loosenOverrideClasses(tmpDir, ["override-judgment"]);
    const prd = await createPrd(tmpDir);
    const spec = await createSpecWithAc(tmpDir, prd.slug, "Spec Never Judged");

    // Zero judgments ever recorded for this doc — NO_JUDGMENT_REASON, the state
    // `--override-judgment` cannot unlock (there is no id to name).
    const blocked = await runLore(["approve", spec.slug], tmpDir);
    expect(blocked.exitCode).toBe(4);
    expect(blocked.stderr).toContain("lore review");

    const overridden = await runLore(["approve", spec.slug, "--override-no-judgment"], tmpDir);
    expect(overridden.exitCode).toBe(0);

    const doc = await getDoc(tmpDir, spec.slug);
    expect(doc.status).toBe("approved");

    const auditDetails = latestApproveAuditDetails(tmpDir, spec.id);
    expect(auditDetails["override_no_judgment"]).toBe(true);
    // Mutually exclusive with the named-id escape — never both present on one audit row.
    expect(auditDetails["override_judgment_id"]).toBeUndefined();
  });

  it("--override-no-judgment is rejected loud when the doc already has a judgment recorded", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "lore-tiered-review-ac5e-"));
    await initCorpus(tmpDir);
    const prd = await createPrd(tmpDir);
    const spec = await createSpecWithAc(tmpDir, prd.slug, "Spec Already Judged, Wrong Escape");
    insertRawJudgment(tmpDir, { docId: spec.id, docVersion: spec.version, decision: "reject" });

    const result = await runLore(["approve", spec.slug, "--override-no-judgment"], tmpDir);
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain("--override-judgment");

    const doc = await getDoc(tmpDir, spec.slug);
    expect(doc.status).toBe("draft");
  });
});

// ─── AC-TIER-8: idempotent ledger backfill ────────────────────────────────────

describe("AC-TIER-8 backfill-ledger", () => {
  it("fast-tracks existing draft ledger docs exactly once; a second run reports zero changes", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "lore-tiered-review-ac8-"));
    await initCorpus(tmpDir);
    const prd = await createPrd(tmpDir);

    // Simulate pre-SPEC-103 legacy drafts: disable the live fast-track toggle BEFORE
    // creating the ledger docs, so they land (and stay) draft — backfill-ledger's job
    // is exactly this one-shot migration sweep, independent of the LIVE toggle's value.
    patchLoreConfig(tmpDir, `project:\n  name: test\n  author: test\nworkflow:\n  review:\n    ledger_auto_approve: false\n`);

    const retroA = await runLore(
      ["create", "knowledge", "--sub-type", "retro", "--title", "Retro A", "--parent", prd.slug, "--content", "x", "--json"],
      tmpDir,
    );
    expect(retroA.exitCode).toBe(0);
    const docA = (JSON.parse(retroA.stdout) as JsonEnvelope<DocEnvelope>).data;
    expect(docA.status).toBe("draft");

    const retroB = await runLore(
      ["create", "knowledge", "--sub-type", "retro", "--title", "Retro B", "--parent", prd.slug, "--content", "x", "--json"],
      tmpDir,
    );
    expect(retroB.exitCode).toBe(0);
    const docB = (JSON.parse(retroB.stdout) as JsonEnvelope<DocEnvelope>).data;
    expect(docB.status).toBe("draft");

    const firstRun = await runLore(["review", "backfill-ledger", "--json"], tmpDir);
    expect(firstRun.exitCode).toBe(0);
    const firstReport = (JSON.parse(firstRun.stdout) as JsonEnvelope<{ fast_tracked: string[] }>).data;
    expect(firstReport.fast_tracked).toContain(docA.slug);
    expect(firstReport.fast_tracked).toContain(docB.slug);

    expect((await getDoc(tmpDir, docA.slug)).status).toBe("approved");
    expect((await getDoc(tmpDir, docB.slug)).status).toBe("approved");

    const secondRun = await runLore(["review", "backfill-ledger", "--json"], tmpDir);
    expect(secondRun.exitCode).toBe(0);
    const secondReport = (JSON.parse(secondRun.stdout) as JsonEnvelope<{ fast_tracked: string[] }>).data;
    expect(secondReport.fast_tracked).toEqual([]);
  });
});
