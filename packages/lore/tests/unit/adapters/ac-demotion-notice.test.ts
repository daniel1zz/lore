// @spawns packages/lore/src/index.ts
// @spawns packages/lore/tests/helpers/approve-nodes-cli.ts
/**
 * AC-GV-4 (spec-governance-visibility-an-armed-gate-that-vacuously-passes §B2) —
 * `lore ac add`/`lore ac set` PRINT the approved->draft demotion `commands/ac.ts:50`
 * used to document only in a code comment, PLUS a count of descendant task docs
 * (via child plans, `isPlanMember`) whose future `claim` this demotion now blocks.
 * The demotion itself is unchanged, correct lifecycle behaviour
 * (`resolveStatusAfterContractEdit`, `@lore/core`) — only its SILENCE was the defect.
 *
 * ⛔ Load-bearing negative half: a write that does NOT cause a demotion (spec
 * already draft, or `ac add`, which per `AcService.writeCriteria`'s `add`/`remove`
 * branches never changes status at all) must print NEITHER line. An unconditional
 * notice would satisfy a naive "the string appears somewhere" assertion while
 * training operators to ignore it — this suite explicitly falsifies that shape by
 * running a SECOND edit (on the now-`draft` spec) and asserting silence, plus a
 * REJECTED write and a status-neutral `ac add`.
 *
 * `commands/ac.ts` transitively imports `loader.ts` -> `app.ts` -> `bun:sqlite`,
 * unresolvable by vitest as a direct import (measured — see `cli-ac-set.test.ts`'s
 * own header: "importing `commands/ac.ts` directly under vitest throws 'Cannot find
 * package bun:sqlite'"). Spawns the REAL CLI against a throwaway `lore init` corpus,
 * mirroring that same proven subprocess pattern (also `approve-advisory-render.
 * test.ts`). Never writes to this repo's own `.lore/`.
 *
 * Coverage (all six dimensions live under ONE `describe` title carrying the
 * `demotion-blast-radius` token this task's oracle command filters on):
 *   HAPPY:      `ac set` on an approved spec with 2 non-terminal descendant tasks
 *               (under a child plan) prints BOTH the demotion AND "2" on stderr,
 *               keeps exit 0; stdout carries only the one-line demotion
 *               announcement (D18), never the blast-radius count.
 *   BOUNDARY:   the SAME set-demotion with ZERO child plans/tasks prints the
 *               demotion line with an explicit "0" — the count is never omitted
 *               just because it's zero (project convention: an omitted count is
 *               the same silence as an uncounted retraction).
 *   NEGATIVE:   `ac add` on a draft spec (never demotes — add/remove never touch
 *               status, `AcService.writeCriteria`) prints NEITHER line.
 *   STATE:      a SECOND `ac set` on the now-draft spec (post first demotion)
 *               prints NEITHER line — proves the check is the OBSERVED before/
 *               after transition, not "did this subcommand run at all".
 *   ERROR:      a REJECTED `ac set` (unknown criterion id, VALIDATION_ERROR) never
 *               demotes anything and prints neither line, alongside its own error.
 *   REGRESSION: `--json` mode still emits the notice to STDERR (never polluting
 *               the `--json` stdout payload), mirroring `anchor add`'s established
 *               non-blocking-advisory convention.
 *
 * @spec_ref spec-governance-visibility-an-armed-gate-that-vacuously-passes §B2 AC-GV-4
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "child_process";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { saveConfig } from "@lore/core/node";
import type { LoreConfig } from "@lore/core";
import { citeSpecViaCli } from "../../helpers/cli-live-rule.js";
import { planFieldsArgs, templatedFieldsArgs } from "../../helpers/templated-create.js";
import { DECIDED_FLAGS } from "../../helpers/decision-flags.js";

// tests/unit/adapters/ → tests/unit/ → tests/ → packages/lore/
const PACKAGE_ROOT = new URL("../../../", import.meta.url).pathname.replace(/\/$/, "");
const INDEX_TS = join(PACKAGE_ROOT, "src", "index.ts");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** Spawn `bun run <INDEX_TS> ...args` in `cwd` with an isolated HOME dir and a fixed
 *  actor identity (mirrors `approve-advisory-render.test.ts` — a stable identity
 *  keeps stderr free of an unrelated actor-traceability warning that would otherwise
 *  pollute the exact stderr assertions below). */
function runLore(args: string[], cwd: string): RunResult {
  // reason: a stable identity WITHOUT `$LORE_ACTOR` — that variable now draws a one-line deprecation warning on
  // stderr (spec-run-identity-slice-1 D8), which would pollute the exact stderr assertions below. The session
  // tier names the writer and prints nothing.
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: cwd, EDITOR: "true", CLAUDE_CODE_SESSION_ID: "stable-probe-session" };
  delete env["LORE_ACTOR"];
  const result = spawnSync("bun", ["run", INDEX_TS, ...args], {
    cwd,
    env,
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

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "lore-ac-demotion-notice-"));
  const init = runLore(["init"], tmpDir);
  if (init.exitCode !== 0) throw new Error(`lore init failed: ${init.stderr}`);
  // Neutralizes SPEC-103 M2's judgment-required floor (unrelated to this suite) so
  // `lore approve <spec>` succeeds without a recorded AI judgment — mirrors
  // approve-advisory-render.test.ts's own precedent for the SAME gate.
  const config: LoreConfig = {
    project: { name: "ac-demotion-notice-test", author: "tester" },
    // `record-edit` is switched off through its one config knob: this suite pins the approved->draft
    // demotion notice, which only an UNLOCKED approved spec can reach now that `ac add|set` on a locked
    // (ever-approved) spec is refused (spec-documents-are-living-or-records D12). The refusal itself is
    // pinned in record-lock-ac-restore.test.ts.
    workflow: { review: { judgment_required_types: [] }, gates: { "record-edit": { enabled: false } } },
  } as unknown as LoreConfig;
  const saveResult = saveConfig(tmpDir, config);
  if (!saveResult.ok) throw new Error(`saveConfig failed: ${JSON.stringify(saveResult.error)}`);
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

function createPrd(dir: string, title: string): string {
  const r = runLore(["create", "prd", "--title", title, ...templatedFieldsArgs("prd"), "--no-ai"], dir);
  if (r.exitCode !== 0) throw new Error(`create prd failed: ${r.stderr}`);
  return parseSlug(r.stdout);
}

function createSpec(dir: string, parentSlug: string, title: string): string {
  const r = runLore(
    ["create", "spec", "--title", title, ...templatedFieldsArgs("spec", { kind: "feature" }), "--no-ai"],
    dir,
  );
  if (r.exitCode !== 0) throw new Error(`create spec failed: ${r.stderr}`);
  return parseSlug(r.stdout);
}

function addHumanAc(dir: string, specSlug: string, id: string, statement: string): void {
  const r = runLore(["ac", "add", specSlug, id, "--statement", statement, "--mode", "human"], dir);
  if (r.exitCode !== 0) throw new Error(`ac add failed: ${r.stderr}`);
}

function approveDoc(dir: string, slug: string): void {
  // BR-1007: the spec's criterion AC-1 cites the corpus's live fixture rule, so the approval is accepted.
  citeSpecViaCli(
    (args) => {
      const c = runLore(args, dir);
      if (c.exitCode !== 0) throw new Error(`${args.join(" ")}: ${c.stderr}`);
      return c.stdout;
    },
    dir,
    undefined,
    slug,
    "AC-1",
  );
  const r = runLore(["approve", slug], dir);
  if (r.exitCode !== 0) throw new Error(`approve ${slug} failed (setup): ${r.stderr}`);
}

function createPlan(dir: string, parentSlug: string, title: string): string {
  const r = runLore(
    ["create", "plan", "--title", title, "--parent", parentSlug, ...planFieldsArgs(parentSlug), "--no-ai"],
    dir,
  );
  if (r.exitCode !== 0) throw new Error(`create plan failed: ${r.stderr}`);
  return parseSlug(r.stdout);
}

function createTask(dir: string, planSlug: string, title: string): string {
  const r = runLore(
    ["create", "task", "--plan-id", planSlug, "--title", title, "--kind", "code", ...templatedFieldsArgs("task"), "--no-ai"],
    dir,
  );
  if (r.exitCode !== 0) throw new Error(`create task failed: ${r.stderr}`);
  return parseSlug(r.stdout);
}

/** Reads a doc's CURRENT status via `lore get --json` (never trusted from a stale
 *  in-test snapshot — always a fresh read against the throwaway corpus). */
function getStatus(dir: string, slug: string): string {
  const r = runLore(["get", slug, "--json"], dir);
  if (r.exitCode !== 0) throw new Error(`get ${slug} failed: ${r.stderr}`);
  return (JSON.parse(r.stdout) as { data: { doc: { status: string } } }).data.doc.status;
}

describe("demotion-blast-radius — ac add/set print the approved-to-draft demotion + blocked-claim count (AC-GV-4)", () => {
  it(
    "HAPPY + BOUNDARY: prints the demotion and the EXACT descendant-task count, zero included",
    { timeout: 120_000 },
    () => {
      const prdSlug = createPrd(tmpDir, "GV4 PRD");

      // --- BOUNDARY: zero descendant tasks (no child plan at all) ---
      const zeroSpecSlug = createSpec(tmpDir, prdSlug, "GV4 Spec Zero Descendants");
      addHumanAc(tmpDir, zeroSpecSlug, "AC-1", "Rejects malformed input with a named field");
      approveDoc(tmpDir, zeroSpecSlug);
      expect(getStatus(tmpDir, zeroSpecSlug)).toBe("approved");

      const zeroResult = runLore(
        ["ac", "set", zeroSpecSlug, "AC-1", "--statement", "Rejects malformed input with an exact field name", ...DECIDED_FLAGS],
        tmpDir,
      );
      expect(zeroResult.exitCode).toBe(0);
      expect(zeroResult.stderr).toMatch(/approved/i);
      expect(zeroResult.stderr).toMatch(/draft/i);
      expect(zeroResult.stderr).toMatch(/\b0\b/);
      expect(getStatus(tmpDir, zeroSpecSlug)).toBe("draft");

      // --- HAPPY: two non-terminal descendant tasks under one child plan ---
      const specSlug = createSpec(tmpDir, prdSlug, "GV4 Spec Two Descendants");
      addHumanAc(tmpDir, specSlug, "AC-1", "Rejects malformed input with a named field");
      approveDoc(tmpDir, specSlug);
      const planSlug = createPlan(tmpDir, specSlug, "GV4 Plan");
      createTask(tmpDir, planSlug, "GV4 Task One");
      createTask(tmpDir, planSlug, "GV4 Task Two");
      expect(getStatus(tmpDir, specSlug)).toBe("approved");

      const result = runLore(
        ["ac", "set", specSlug, "AC-1", "--statement", "Rejects malformed input with an exact field name", ...DECIDED_FLAGS],
        tmpDir,
      );
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toMatch(/approved/i);
      expect(result.stderr).toMatch(/draft/i);
      expect(result.stderr).toMatch(/\b2\b/);
      // D18 (spec-defect-clusters-round-2-part-c-criterion-data-demotion): the demotion is ALSO announced on
      // stdout as one line, so a caller reading only stdout learns the spec left `approved`. The blast-radius
      // advisory stays on stderr only.
      expect(result.stdout).toContain(`${specSlug} was approved and is now draft (v`);
      expect(result.stdout).not.toMatch(/descendant task claim/i);
      expect(getStatus(tmpDir, specSlug)).toBe("draft");
    },
  );

  it(
    "NEGATIVE: `ac add` on a draft spec never demotes and prints neither line",
    { timeout: 60_000 },
    () => {
      const prdSlug = createPrd(tmpDir, "GV4 PRD Negative");
      const specSlug = createSpec(tmpDir, prdSlug, "GV4 Negative Spec");

      const result = runLore(
        [
          "ac",
          "add",
          specSlug,
          "AC-1",
          "--statement",
          "Rejects malformed input with a named field",
          "--mode",
          "human",
        ],
        tmpDir,
      );
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(getStatus(tmpDir, specSlug)).toBe("draft");
    },
  );

  it(
    "STATE: a second `ac set` on an already-draft spec (post first demotion) prints neither line",
    { timeout: 60_000 },
    () => {
      const prdSlug = createPrd(tmpDir, "GV4 PRD State");
      const specSlug = createSpec(tmpDir, prdSlug, "GV4 State Spec");
      addHumanAc(tmpDir, specSlug, "AC-1", "Rejects malformed input with a named field");
      approveDoc(tmpDir, specSlug);

      const first = runLore(
        ["ac", "set", specSlug, "AC-1", "--statement", "Rejects malformed input with an exact field name", ...DECIDED_FLAGS],
        tmpDir,
      );
      expect(first.exitCode).toBe(0);
      expect(first.stderr).toMatch(/approved/i);
      expect(first.stderr).toMatch(/draft/i);
      expect(getStatus(tmpDir, specSlug)).toBe("draft");

      const second = runLore(
        [
          "ac",
          "set",
          specSlug,
          "AC-1",
          "--statement",
          "Rejects malformed input with yet another exact field name",
        ],
        tmpDir,
      );
      expect(second.exitCode).toBe(0);
      expect(second.stderr).toBe("");
      expect(getStatus(tmpDir, specSlug)).toBe("draft");
    },
  );

  it(
    "ERROR: a rejected `ac set` (unknown criterion id) never demotes and prints neither line",
    { timeout: 60_000 },
    () => {
      const prdSlug = createPrd(tmpDir, "GV4 PRD Error");
      const specSlug = createSpec(tmpDir, prdSlug, "GV4 Error Spec");
      addHumanAc(tmpDir, specSlug, "AC-1", "Rejects malformed input with a named field");
      approveDoc(tmpDir, specSlug);

      const result = runLore(["ac", "set", specSlug, "AC-DOES-NOT-EXIST", "--statement", "irrelevant"], tmpDir);
      expect(result.exitCode).toBe(4);
      expect(result.stderr).not.toMatch(/draft/i);
      expect(getStatus(tmpDir, specSlug)).toBe("approved");
    },
  );

  it(
    "REGRESSION: --json mode still prints the notice to stderr, never polluting stdout's JSON payload",
    { timeout: 60_000 },
    () => {
      const prdSlug = createPrd(tmpDir, "GV4 PRD JSON");
      const specSlug = createSpec(tmpDir, prdSlug, "GV4 JSON Spec");
      addHumanAc(tmpDir, specSlug, "AC-1", "Rejects malformed input with a named field");
      approveDoc(tmpDir, specSlug);

      const result = runLore(
        [
          "ac",
          "set",
          specSlug,
          "AC-1",
          "--statement",
          "Rejects malformed input with an exact field name",
          ...DECIDED_FLAGS,
          "--json",
        ],
        tmpDir,
      );
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toMatch(/approved/i);
      expect(result.stderr).toMatch(/draft/i);
      expect(() => JSON.parse(result.stdout)).not.toThrow();
      const parsed = JSON.parse(result.stdout) as { ok: boolean };
      expect(parsed.ok).toBe(true);
    },
  );
});
