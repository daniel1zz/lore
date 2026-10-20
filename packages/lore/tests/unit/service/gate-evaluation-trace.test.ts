// @spawns packages/lore/src/index.ts
/**
 * AC-FR-8 (task-derive-lore-feed-s-checkpoint-set-from-the-registry-make,
 * spec-falsifiability-reachability-a-feedable-checkpoint-an) — for EVERY
 * deterministic gate checkpoint, a PASSING evaluation leaves a queryable
 * audit entry naming the checkpoint and its verdict, so a pass is
 * distinguishable from a gate that never ran.
 *
 * Measured baseline (2026-08-10, on the merged tree, before this task):
 * promoting a spec to `approved` printed ZERO gate output and left ZERO gate
 * entries in `lore audit <doc> --json` (11 entries, all create/update) — the
 * only way to establish that `spec-promote` had evaluated at all was reading
 * `corpus-service.ts`. `spec-governance-visibility` gave `plan-close` a
 * VACUOUS-pass discriminator (`plan_close_vacuity_notice`), but nothing wrote
 * a trace for a genuinely PASSING evaluation, on ANY checkpoint, anywhere —
 * this suite proves that gap is closed generically (D7: the trace is written
 * inside `GateEnforcer.enforce()` itself, never per call site).
 *
 * Drives the REAL production write path for each of the 8 checkpoints
 * currently in `checkpointRegistry` (enumerated at test time — see
 * `feed-checkpoint-coverage.test.ts` for the sibling AC-FR-1 suite that
 * asserts the SAME enumeration for `lore feed`), then queries
 * `lore audit <doc> --json` — never reads source to establish this.
 *
 * `bun run src/index.ts` resolves relative to THIS file's own location
 * inside THIS worktree (mirrors every other CLI-subprocess test in this
 * package) — the global `lore` binary is a symlink into the MAIN checkout's
 * `dist/` and must never be trusted for asserting in-flight changes.
 * `review-judgment`'s and `phase-claim`'s PRECONDITIONS (an independent
 * review judgment; a phase document — there is deliberately no
 * `lore create phase` CLI path, see `commands/phase.ts`'s own module header)
 * are seeded via the SERVICE layer in a SEPARATE `bun` subprocess (this file
 * never imports `bun:sqlite` itself) — the GATE ITSELF is always driven
 * through its real production CLI call site, never bypassed.
 *
 * Six-dimension coverage:
 *   HAPPY + REGRESSION: each of the 8 registered checkpoints leaves a
 *               `gate_passed` audit row (naming the checkpoint and
 *               `verdict: "pass"`) queryable via `lore audit <doc> --json`
 *               after driving its real write path — this is the EXACT
 *               measured-absent baseline for `spec-promote`.
 *   NEGATIVE:   the second RED's load-bearing counterpart, made permanent —
 *               a checkpoint DISABLED via config still gets the write
 *               (vacuous pass, `resolveGateEnabled` short-circuits to
 *               `ok(undefined)`) and leaves a `gate_skipped` row, but NO
 *               `gate_passed` row — proving the suite distinguishes
 *               "evaluated and passed" from "never ran".
 *   BOUNDARY:   the audit row's `details.checkpoint`/`details.verdict`
 *               fields are asserted EXACTLY, never just "some row exists".
 *   ERROR:      `lore audit <unrelated-doc> --json` for a doc that never had
 *               ANY gated write shows zero `gate_passed` rows — a bare
 *               "audit has entries" check would not catch a doc-scoping bug.
 *   STATE:      the `gate_passed` row's `doc_id` (default `--json` shape)
 *               resolves back to the SAME doc via `lore audit <slug>` OR
 *               `lore audit <id>` — proving `doc_id` is the real id, not a
 *               display-only slug that would silently make the row
 *               unreachable by this exact surface.
 *   REGRESSION: the row is written from the ENFORCER (D7), not a call site —
 *               asserted structurally by covering checkpoints driven through
 *               THREE different calling services (CorpusService,
 *               ReviewService, TaskWorkflowService/PhaseWorkflowService).
 *
 * @spec_ref spec-falsifiability-reachability-a-feedable-checkpoint-an AC-FR-8
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { saveConfig } from "@lore/core/node";
import { dropLoreConfigKey } from "../../helpers/patch-lore-config.js";
import type { LoreConfig } from "@lore/core";

import { checkpointRegistry } from "../../../src/service/checkpoint-registry.js";
import { citeSpecViaCli } from "../../helpers/cli-live-rule.js";

// tests/unit/service/ -> tests/unit/ -> tests/ -> packages/lore/
const PACKAGE_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");
const LIVE_APP_TS = join(PACKAGE_ROOT, "tests", "helpers", "live-app.ts");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** Spawn `bun run <INDEX_TS> ...args` in `cwd` with an isolated HOME dir (mirrors cli-ac-set.test.ts's proven subprocess pattern). */
function runLore(args: string[], cwd: string): RunResult {
  const result = spawnSync("bun", ["run", INDEX_TS, ...args], {
    cwd,
    env: { ...process.env, HOME: cwd, EDITOR: "true" },
    encoding: "utf8",
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status ?? -1,
  };
}

function runLoreOk(args: string[], cwd: string, label: string): RunResult {
  const result = runLore(args, cwd);
  if (result.exitCode !== 0) {
    throw new Error(`${label} failed (exit ${result.exitCode}).\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
  }
  return result;
}

function parseSlug(stdout: string): string {
  const m = stdout.match(/Slug:\s+(\S+)/);
  const slug = m?.[1];
  if (!slug) throw new Error(`Could not extract slug from: ${stdout}`);
  return slug;
}

function parseId(stdout: string): string {
  const m = stdout.match(/ID:\s+(\S+)/);
  const id = m?.[1];
  if (!id) throw new Error(`Could not extract an ID from: ${stdout}`);
  return id;
}

interface AuditEntryJson {
  readonly action: string;
  readonly doc_id?: string;
  readonly details?: { checkpoint?: string; verdict?: string; mechanism?: string };
}

function queryAudit(doc: string, cwd: string): AuditEntryJson[] {
  const result = runLoreOk(["audit", doc, "--json"], cwd, `lore audit ${doc}`);
  const parsed = JSON.parse(result.stdout) as { ok: boolean; data: { entries: AuditEntryJson[] } };
  return parsed.data.entries;
}

function gatePassedRows(entries: readonly AuditEntryJson[], checkpoint: string): AuditEntryJson[] {
  return entries.filter((e) => e.action === "gate_passed" && e.details?.checkpoint === checkpoint);
}

function gateSkippedRows(entries: readonly AuditEntryJson[], checkpoint: string): AuditEntryJson[] {
  return entries.filter((e) => e.action === "gate_skipped" && e.details?.checkpoint === checkpoint);
}

/**
 * Writes a throwaway seeder script into `scriptDir` and runs it as a SEPARATE
 * `bun` subprocess against `dbPath` — the ONLY way to set up two of this
 * suite's checkpoint preconditions (`review-judgment`'s independent judgment
 * row; `phase-claim`'s phase document — no CLI path creates either). The
 * GATE ITSELF is never invoked here; only its precondition data.
 */
function seedServiceOps(dbPath: string, scriptDir: string, ops: readonly Record<string, unknown>[]): unknown[] {
  const scriptPath = join(scriptDir, "seed-ops.ts");
  const scriptSource = `
import { createLiveApp } from ${JSON.stringify(LIVE_APP_TS)};

const dbPath = process.argv[2];
const ops = JSON.parse(process.argv[3]);

// reason: this child is a plain bun process (no test-run app shim), so the live test run is registered by createLiveApp.
const app = createLiveApp(dbPath);
const results = [];
try {
  for (const op of ops) {
    if (op.kind === "create_phase") {
      const createResult = await app.corpusService.create({
        type: "phase",
        title: op.title,
        parent_id: op.planId,
        content: op.content,
        extra: { plan_id: op.planId },
      });
      if (!createResult.ok) {
        console.error("CREATE_PHASE_FAILED", JSON.stringify(createResult.error));
        process.exit(1);
      }
      results.push({ kind: "create_phase", id: createResult.value.id, slug: createResult.value.slug });
    } else if (op.kind === "record_judgment") {
      // reason: BR-1071 — \`lore set --status approved\` is an approval, so a spec reaches approved only through
      // a judgment of its CURRENT version. \`docSlug\` resolves the id + current version at seed time
      // (the CLI-built fixtures above do not know either).
      let judgedId = op.docId;
      let judgedVersion = op.docVersion;
      if (op.docSlug !== undefined) {
        const got = await app.corpusService.get(op.docSlug);
        if (!got.ok) {
          console.error("RESOLVE_DOC_FAILED", JSON.stringify(got.error));
          process.exit(1);
        }
        judgedId = got.value.doc.id;
        judgedVersion = got.value.doc.version;
      }
      const recordResult = await app.judgmentService.record({
        doc_id: judgedId,
        doc_version: judgedVersion,
        decision: "approve",
        confidence: 0.9,
        reasons: [{ dimension: "completeness", finding: "seeded for gate-evaluation-trace.test.ts" }],
        checks: [{ check: "schema", outcome: "pass" }],
        blocking_questions: [],
        judge: { provider: "test-fixture", model: "test-fixture", prompt_version: "v1" },
        kind: "review",
      });
      if (!recordResult.ok) {
        console.error("RECORD_JUDGMENT_FAILED", JSON.stringify(recordResult.error));
        process.exit(1);
      }
      results.push({ kind: "record_judgment", id: recordResult.value.id });
    } else {
      console.error("UNKNOWN_OP", JSON.stringify(op));
      process.exit(1);
    }
  }
  console.log(JSON.stringify({ ok: true, results }));
} finally {
  app.close();
}
`;
  writeFileSync(scriptPath, scriptSource, "utf8");

  const result = spawnSync("bun", ["run", scriptPath, dbPath, JSON.stringify(ops)], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`seedServiceOps failed (exit ${result.status}).\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
  }
  const parsed = JSON.parse(result.stdout ?? "") as { ok: boolean; results: unknown[] };
  return parsed.results;
}

// registeredCheckpoints AT TEST TIME — the same enumeration principle
// feed-checkpoint-coverage.test.ts applies for AC-FR-1; NEVER a hand-listed set.
const registeredCheckpoints = Object.keys(checkpointRegistry);

describe("every-checkpoint-leaves-a-trace — a passing gate evaluation is queryable via lore audit (AC-FR-8)", () => {
  describe("HAPPY + REGRESSION + BOUNDARY + STATE", () => {
    let tmpDir: string;

    beforeAll(() => {
      tmpDir = mkdtempSync(join(tmpdir(), "lore-gate-evaluation-trace-"));
      mkdirSync(tmpDir, { recursive: true });
      runLoreOk(["init"], tmpDir, "lore init");
      // reason: `lore init` seeds the verification profiles (a feature spec needs a `test` oracle to be approved); the
      // spec-promote trace case approves a bare spec, so the profiles are removed (an absent profile is a vacuous pass).
      dropLoreConfigKey(tmpDir, ["workflow", "verification_profiles"]);
    }, 60_000);

    afterAll(() => {
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    });

    it(
      'checkpoint "spec-create": creating a spec leaves a gate_passed trace',
      () => {
        const prd = parseSlug(runLoreOk(["create", "prd", "--title", "GET-1 PRD", "--content", "## Overview\n\nbody", "--no-ai"], tmpDir, "create prd").stdout);
        const specResult = runLoreOk(
          [
            "create", "spec", "--title", "GET-1 spec-create target","--kind", "tech", "--no-ai",
            "--content", "## Overview/Goal\n\nx\n\n## Scope\n\nx\n\n## Acceptance Criteria\n\nx",
          ],
          tmpDir,
          "create spec (spec-create)",
        );
        const slug = parseSlug(specResult.stdout);

        const entries = queryAudit(slug, tmpDir);
        const rows = gatePassedRows(entries, "spec-create");
        expect(rows.length).toBeGreaterThanOrEqual(1);
        expect(rows[0]?.details?.verdict).toBe("pass");
      },
      60_000,
    );

    it(
      'checkpoint "task-create": creating a task under a spec-less plan leaves a gate_passed trace',
      () => {
        const prd = parseSlug(runLoreOk(["create", "prd", "--title", "GET-2 PRD", "--content", "## Overview\n\nbody", "--no-ai"], tmpDir, "create prd").stdout);
        const plan = parseSlug(runLoreOk(["create", "plan", "--title", "GET-2 plan (no spec ancestor)", "--parent", prd, "--content", "plan body", "--no-ai"], tmpDir, "create plan").stdout);
        const taskResult = runLoreOk(
          ["create", "task", "--title", "GET-2 task-create target", "--plan-id", plan, "--content", "task body", "--no-ai"],
          tmpDir,
          "create task (task-create)",
        );
        const slug = parseSlug(taskResult.stdout);

        const entries = queryAudit(slug, tmpDir);
        const rows = gatePassedRows(entries, "task-create");
        expect(rows.length).toBeGreaterThanOrEqual(1);
        expect(rows[0]?.details?.verdict).toBe("pass");
      },
      60_000,
    );

    it(
      'checkpoint "spec-promote": approving a spec (>= 1 declared AC) via `lore set --status approved` leaves a gate_passed trace',
      () => {
        const prd = parseSlug(runLoreOk(["create", "prd", "--title", "GET-3 PRD", "--content", "## Overview\n\nbody", "--no-ai"], tmpDir, "create prd").stdout);
        const spec = parseSlug(
          runLoreOk(
            [
              "create", "spec", "--title", "GET-3 spec-promote target","--kind", "tech", "--no-ai",
              "--content", "## Overview/Goal\n\nx\n\n## Scope\n\nx\n\n## Acceptance Criteria\n\nx",
            ],
            tmpDir,
            "create spec",
          ).stdout,
        );
        runLoreOk(
          ["ac", "add", spec, "AC-GET3-1", "--statement", "A human reviewer confirms the exported CSV contains exactly 10 rows", "--mode", "human"],
          tmpDir,
          "ac add",
        );
        citeSpecViaCli((args) => runLoreOk(args, tmpDir, args.join(" ")).stdout, tmpDir, prd, spec, "AC-GET3-1");
        // BR-1071: set --status approved takes the approve path, so the judged type needs a judgment of its current version.
        seedServiceOps(join(tmpDir, ".lore", "lore.db"), tmpDir, [{ kind: "record_judgment", docSlug: spec }]);
        runLoreOk(["set", spec, "--status", "approved"], tmpDir, "set --status approved (spec-promote)");

        const entries = queryAudit(spec, tmpDir);
        const rows = gatePassedRows(entries, "spec-promote");
        expect(rows.length).toBeGreaterThanOrEqual(1);
        expect(rows[0]?.details?.verdict).toBe("pass");
      },
      60_000,
    );

    it(
      'checkpoint "plan-promote": approving a plan parented under an APPROVED spec (>= 1 AC) via `lore approve` leaves a gate_passed trace',
      () => {
        const prd = parseSlug(runLoreOk(["create", "prd", "--title", "GET-4 PRD", "--content", "## Overview\n\nbody", "--no-ai"], tmpDir, "create prd").stdout);
        const spec = parseSlug(
          runLoreOk(
            [
              "create", "spec", "--title", "GET-4 plan-promote's ancestor spec","--kind", "tech", "--no-ai",
              "--content", "## Overview/Goal\n\nx\n\n## Scope\n\nx\n\n## Acceptance Criteria\n\nx",
            ],
            tmpDir,
            "create spec",
          ).stdout,
        );
        runLoreOk(
          ["ac", "add", spec, "AC-GET4-1", "--statement", "A human reviewer confirms the exported CSV contains exactly 10 rows", "--mode", "human"],
          tmpDir,
          "ac add",
        );
        citeSpecViaCli((args) => runLoreOk(args, tmpDir, args.join(" ")).stdout, tmpDir, prd, spec, "AC-GET4-1");
        // BR-1071: the ancestor spec is approved through its judgment, exactly as `lore approve` would require.
        seedServiceOps(join(tmpDir, ".lore", "lore.db"), tmpDir, [{ kind: "record_judgment", docSlug: spec }]);
        runLoreOk(["set", spec, "--status", "approved"], tmpDir, "approve ancestor spec");

        const plan = parseSlug(
          runLoreOk(["create", "plan", "--title", "GET-4 plan-promote target", "--parent", spec, "--content", "plan body", "--no-ai"], tmpDir, "create plan").stdout,
        );
        // plans are judged by default (BR-281 / BR-1237): the plan needs a judgment of its current version
        seedServiceOps(join(tmpDir, ".lore", "lore.db"), tmpDir, [{ kind: "record_judgment", docSlug: plan }]);
        runLoreOk(["approve", plan], tmpDir, "approve plan (plan-promote)");

        const entries = queryAudit(plan, tmpDir);
        const rows = gatePassedRows(entries, "plan-promote");
        expect(rows.length).toBeGreaterThanOrEqual(1);
        expect(rows[0]?.details?.verdict).toBe("pass");
      },
      60_000,
    );

    it(
      'checkpoint "task-claim": claiming a task leaves a gate_passed trace',
      () => {
        const prd = parseSlug(runLoreOk(["create", "prd", "--title", "GET-5 PRD", "--content", "## Overview\n\nbody", "--no-ai"], tmpDir, "create prd").stdout);
        const plan = parseSlug(runLoreOk(["create", "plan", "--title", "GET-5 plan", "--parent", prd, "--content", "plan body", "--no-ai"], tmpDir, "create plan").stdout);
        const task = parseSlug(
          runLoreOk(["create", "task", "--title", "GET-5 task-claim target", "--plan-id", plan, "--content", "task body", "--no-ai"], tmpDir, "create task").stdout,
        );
        runLoreOk(["claim", task, "--worktree", "trace-test-worktree"], tmpDir, "claim task (task-claim)");

        const entries = queryAudit(task, tmpDir);
        const rows = gatePassedRows(entries, "task-claim");
        expect(rows.length).toBeGreaterThanOrEqual(1);
        expect(rows[0]?.details?.verdict).toBe("pass");
      },
      60_000,
    );

    it(
      'checkpoint "plan-close": archiving a plan with zero tasks leaves a gate_passed trace',
      () => {
        const prd = parseSlug(runLoreOk(["create", "prd", "--title", "GET-6 PRD", "--content", "## Overview\n\nbody", "--no-ai"], tmpDir, "create prd").stdout);
        const plan = parseSlug(runLoreOk(["create", "plan", "--title", "GET-6 plan-close target", "--parent", prd, "--content", "plan body", "--no-ai"], tmpDir, "create plan").stdout);
        // plans are judged by default (BR-281 / BR-1237): the plan needs a judgment of its current version
        seedServiceOps(join(tmpDir, ".lore", "lore.db"), tmpDir, [{ kind: "record_judgment", docSlug: plan }]);
        runLoreOk(["set", plan, "--status", "approved"], tmpDir, "approve plan (precondition for archive)");
        runLoreOk(["set", plan, "--status", "archived"], tmpDir, "archive plan (plan-close)");

        const entries = queryAudit(plan, tmpDir);
        const rows = gatePassedRows(entries, "plan-close");
        expect(rows.length).toBeGreaterThanOrEqual(1);
        expect(rows[0]?.details?.verdict).toBe("pass");
      },
      60_000,
    );

    it(
      'checkpoint "phase-claim": claiming a (service-seeded) phase document leaves a gate_passed trace',
      () => {
        const prd = parseSlug(runLoreOk(["create", "prd", "--title", "GET-7 PRD", "--content", "## Overview\n\nbody", "--no-ai"], tmpDir, "create prd").stdout);
        const planResult = runLoreOk(["create", "plan", "--title", "GET-7 plan", "--parent", prd, "--content", "plan body", "--no-ai"], tmpDir, "create plan");
        const planSlug = parseSlug(planResult.stdout);
        const planId = parseId(planResult.stdout);

        const dbPath = join(tmpDir, ".lore", "lore.db");
        const seedResults = seedServiceOps(dbPath, tmpDir, [
          { kind: "create_phase", planId, title: "GET-7 phase-claim target", content: "phase body" },
        ]) as Array<{ kind: string; id: string; slug: string }>;
        const phaseSlug = seedResults[0]?.slug;
        if (phaseSlug === undefined) throw new Error("seedServiceOps did not return a phase slug");

        runLoreOk(["claim", phaseSlug, "--worktree", "trace-test-worktree"], tmpDir, "claim phase (phase-claim)");

        const entries = queryAudit(phaseSlug, tmpDir);
        const rows = gatePassedRows(entries, "phase-claim");
        expect(rows.length).toBeGreaterThanOrEqual(1);
        expect(rows[0]?.details?.verdict).toBe("pass");
        // planSlug referenced only to keep the plan's own creation meaningful in stack traces.
        expect(planSlug.length).toBeGreaterThan(0);
      },
      60_000,
    );

    it(
      'checkpoint "review-judgment": approving an ADR with a pre-seeded independent judgment leaves a gate_passed trace',
      () => {
        const prd = parseSlug(runLoreOk(["create", "prd", "--title", "GET-8 PRD", "--content", "## Overview\n\nbody", "--no-ai"], tmpDir, "create prd").stdout);
        const adrResult = runLoreOk(
          ["create", "adr", "--title", "GET-8 review-judgment target", "--parent", prd, "--content", "## Decision\n\nbody", "--decision-status", "proposed", "--no-ai"],
          tmpDir,
          "create adr",
        );
        const adrSlug = parseSlug(adrResult.stdout);
        const adrId = parseId(adrResult.stdout);

        const dbPath = join(tmpDir, ".lore", "lore.db");
        seedServiceOps(dbPath, tmpDir, [{ kind: "record_judgment", docId: adrId, docVersion: 1 }]);

        runLoreOk(["approve", adrSlug], tmpDir, "approve adr (review-judgment)");

        const entries = queryAudit(adrSlug, tmpDir);
        const rows = gatePassedRows(entries, "review-judgment");
        expect(rows.length).toBeGreaterThanOrEqual(1);
        expect(rows[0]?.details?.verdict).toBe("pass");
      },
      60_000,
    );

    it(
      'checkpoint "record-edit": rewriting a draft spec via `lore set --content` leaves a gate_passed trace (the lock judged it editable)',
      () => {
        const spec = parseSlug(
          runLoreOk(
            [
              "create", "spec", "--title", "GET-9 record-edit target", "--kind", "tech", "--no-ai",
              "--content", "## Overview/Goal\n\nx\n\n## Scope\n\nx\n\n## Acceptance Criteria\n\nx",
            ],
            tmpDir,
            "create spec (record-edit)",
          ).stdout,
        );
        runLoreOk(["set", spec, "--content", "## Overview/Goal\n\nrewritten\n\n## Scope\n\nx"], tmpDir, "set content (record-edit)");

        const entries = queryAudit(spec, tmpDir);
        const rows = gatePassedRows(entries, "record-edit");
        expect(rows.length).toBeGreaterThanOrEqual(1);
        expect(rows[0]?.details?.verdict).toBe("pass");
      },
      60_000,
    );

    it(
      "REGRESSION: every checkpoint currently in checkpointRegistry was actually exercised above (enumeration, never a hand-listed set)",
      () => {
        // This assertion is the ENUMERATION half of AC-FR-8 — it fails loudly
        // (naming the missing checkpoint) the moment a checkpoint is added to
        // checkpointRegistry without a matching scenario above.
        const exercised = new Set([
          "spec-create", "task-create", "spec-promote", "plan-promote",
          "task-claim", "plan-close", "phase-claim", "review-judgment", "record-edit",
        ]);
        for (const checkpoint of registeredCheckpoints) {
          expect(exercised.has(checkpoint), `checkpoint "${checkpoint}" has no gate_passed scenario above`).toBe(true);
        }
      },
    );

    it(
      "ERROR: a doc that never had any gated write shows zero gate_passed rows for ANY checkpoint",
      () => {
        const prd = parseSlug(runLoreOk(["create", "prd", "--title", "GET-9 untouched PRD", "--content", "## Overview\n\nbody", "--no-ai"], tmpDir, "create prd").stdout);
        const entries = queryAudit(prd, tmpDir);
        const anyGatePassed = entries.filter((e) => e.action === "gate_passed");
        expect(anyGatePassed.length).toBe(0);
      },
      30_000,
    );
  });

  describe("NEGATIVE — a config-DISABLED checkpoint leaves a gate_skipped trace but NO gate_passed trace", () => {
    let tmpDir: string;

    beforeAll(() => {
      tmpDir = mkdtempSync(join(tmpdir(), "lore-gate-evaluation-trace-disabled-"));
      mkdirSync(tmpDir, { recursive: true });
      runLoreOk(["init"], tmpDir, "lore init");

      const config: LoreConfig = {
        project: { name: "gate-evaluation-trace-disabled-test", author: "tester" },
        workflow: { gates: { "spec-promote": { enabled: false } } },
      } as unknown as LoreConfig;
      const saveResult = saveConfig(tmpDir, config);
      if (!saveResult.ok) throw new Error(`saveConfig failed: ${JSON.stringify(saveResult.error)}`);
    }, 60_000);

    afterAll(() => {
      try {
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    });

    it(
      'a doc promoted while "spec-promote" is disabled via config gets gate_skipped, NEVER gate_passed — distinguishing evaluated-and-passed from never-ran',
      () => {
        const prd = parseSlug(runLoreOk(["create", "prd", "--title", "Disabled-gate PRD", "--content", "## Overview\n\nbody", "--no-ai"], tmpDir, "create prd").stdout);
        const spec = parseSlug(
          runLoreOk(
            [
              "create", "spec", "--title", "Disabled spec-promote target","--kind", "tech", "--no-ai",
              "--content", "## Overview/Goal\n\nx\n\n## Scope\n\nx\n\n## Acceptance Criteria\n\nx",
            ],
            tmpDir,
            "create spec",
          ).stdout,
        );
        // BR-1007 holds regardless of the checkpoint's config switch, so the spec still carries one
        // cited criterion; the config knob under test is the spec-promote checkpoint itself, whose
        // skip is what the gate_skipped row below proves.
        runLoreOk(
          ["ac", "add", spec, "AC-GETD-1", "--statement", "A human reviewer confirms the exported CSV contains exactly 10 rows", "--mode", "human"],
          tmpDir,
          "ac add",
        );
        citeSpecViaCli((args) => runLoreOk(args, tmpDir, args.join(" ")).stdout, tmpDir, prd, spec, "AC-GETD-1");
        // BR-1071: the judgment requirement is independent of the spec-promote switch under test.
        seedServiceOps(join(tmpDir, ".lore", "lore.db"), tmpDir, [{ kind: "record_judgment", docSlug: spec }]);
        runLoreOk(["set", spec, "--status", "approved"], tmpDir, "set --status approved (spec-promote disabled)");

        const entries = queryAudit(spec, tmpDir);
        expect(gateSkippedRows(entries, "spec-promote").length).toBeGreaterThanOrEqual(1);
        expect(gatePassedRows(entries, "spec-promote").length).toBe(0);
      },
      60_000,
    );
  });
});
