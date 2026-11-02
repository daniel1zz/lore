// @reads assets/project/lore-config-template.yaml
/**
 * End-to-end tests for the `task-create` admission gate's interaction with
 * `lore verify` (spec-declaring-ac-scope-is-required-at-task-creation-so-the),
 * spawning the COMPILED `dist/lore` binary (Bun.spawnSync) against throwaway
 * corpora (mkdtemp + `lore init`) — never the repo's own `.lore/` corpus
 * (project CLAUDE.md hard rule). Requires `bun run build` first;
 * `assertFreshBinary` fails loud before any test runs if `dist/lore` is
 * missing or older than the newest `.ts` source under `packages/{lore,core}/src`
 * (false-oracle vector 4).
 *
 * Why the COMPILED binary and not `bun run src/index.ts` (the vitest sibling
 * file, `create-task-ac-scope.test.ts`, covers AC-ACS-1/2/3/4/5/7 that way):
 * these two ACs are specifically about `lore verify`'s RUNNER-ATTESTED evidence
 * path — the same "real trusted-runner execution" surface this repo's other
 * `.bun.test.ts` e2e suites (`cli-scope-writer.bun.test.ts`) exercise against
 * the compiled artifact, so a stale build can never silently pass.
 *
 * Coverage:
 *   REGRESSION: `lore verify` with an ABSENT `ac_scope` PLUS an explicit `--ac`
 *               still runs the named id and writes RUNNER-ATTESTED evidence —
 *               the back-catalogue recovery path (D4: the admission rule binds
 *               at CREATE only, it never re-evaluates existing tasks) stays
 *               open. Simulated by creating the fixture task with the
 *               `task-create` checkpoint disabled by config (the same shape a
 *               task created before this rule existed would carry: `ac_scope`
 *               genuinely absent) (AC-ACS-6)
 *   HAPPY (E2E, the whole point): a task created UNDER this rule (declaring
 *               `--ac-scope` because its plan's spec has a script-mode AC) is
 *               verified by `lore verify <plan>` and the resulting evidence
 *               entry — read back via `lore get --json`, never inferred from
 *               a zero exit code alone — carries an `attestation` block
 *               (AC-ACS-8)
 *
 * @spec_ref AC-ACS-6 AC-ACS-8
 *
 * TG-25 (adr-tg-1 option b): the commands run IN-PROCESS through tests/helpers/run-lore-in-process.ts, not through
 * dist/lore. Wherever the prose above says the compiled binary is spawned or its freshness asserted, that is the
 * history of this file; the assertions and the throwaway-corpus rule are unchanged.
 */

import { describe, expect, it, beforeAll, afterEach, vi } from "vitest";
const setDefaultTimeout = (ms: number): void => { vi.setConfig({ testTimeout: ms, hookTimeout: ms }); };
import { mkdtempSync, rmSync, appendFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { runLoreInProcess } from "../../helpers/run-lore-in-process";
import { patchLoreConfig } from "../../helpers/patch-lore-config.js";
import { templatedFieldsArgs } from "../../helpers/templated-create.js";

// reason: each test spawns ~6-7 compiled-binary processes; bun's 5s default
// hook timeout is comfortably exceeded on a loaded machine (mirrors
// cli-scope-writer.bun.test.ts's identical rationale for the same raise).
setDefaultTimeout(120_000);

// tests/integration/cli/ → tests/integration/ → tests/ → packages/lore/ → packages/ → repo root (5 levels up).
const REPO_ROOT = new URL("../../../../../", import.meta.url).pathname.replace(/\/$/, "");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

async function runLore(args: string[], cwd: string): Promise<RunResult> {
  const proc = await runLoreInProcess(args, {
    cwd,
    home: cwd,
    env: { ...process.env, HOME: cwd, EDITOR: "true" },
  });
  return {
    stdout: proc.stdout,
    stderr: proc.stderr,
    exitCode: proc.exitCode,
  };
}

/** Runs a fixture-setup command, failing loud (never silently) on a nonzero exit. */
async function mustRun(args: string[], cwd: string): Promise<RunResult> {
  const result = await runLore(args, cwd);
  if (result.exitCode !== 0) {
    throw new Error(`fixture command \`lore ${args.join(" ")}\` failed (${result.exitCode}): ${result.stderr}`);
  }
  return result;
}

function extractSlug(stdout: string): string {
  const m = stdout.match(/Slug:\s+(\S+)/);
  const slug = m?.[1];
  if (!slug) throw new Error(`Could not extract slug from: ${stdout}`);
  return slug;
}

interface DocJson {
  readonly slug: string;
  readonly extra: Record<string, unknown>;
}

async function getDoc(slug: string, cwd: string): Promise<DocJson> {
  const result = await mustRun(["get", slug, "--json"], cwd);
  return (JSON.parse(result.stdout) as { data: { doc: DocJson } }).data.doc;
}

let tmpDir: string;

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

// ─── AC-ACS-6 — REGRESSION: ac_scope ABSENT + explicit --ac still attests ───

describe("lore verify — ac_scope ABSENT + explicit --ac (AC-ACS-6, back-catalogue recovery)", () => {
  it("still runs the named id and writes runner-attested evidence", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "lore-acscope-e2e-regression-"));
    await mustRun(["init"], tmpDir);

    // reason: simulates a task created BEFORE this admission rule existed —
    // the ONLY way to construct a real ac_scope-ABSENT task under a
    // script-lineaged plan now that task-create refuses it by default.
    // Disabling the checkpoint for creation does not touch `lore verify`'s
    // OWN escape valve under test below; once created, the doc's ac_scope
    // is genuinely absent regardless of why.
    patchLoreConfig(
      tmpDir,
      ["workflow:", "  gates:", '    "task-create":', "      enabled: false", ""].join("\n"),
    );

    await mustRun(["create", "prd", "--title", "Regression PRD", "--no-ai", ...templatedFieldsArgs("prd")], tmpDir);
    await mustRun(
      ["create", "spec", "--title", "Regression Spec", "--no-ai", ...templatedFieldsArgs("spec", { kind: "feature" })],
      tmpDir,
    );
    await mustRun(
      [
        "ac",
        "add",
        "spec-regression-spec",
        "AC-REG-1",
        "--statement",
        "A dogfood AC.",
        "--mode",
        "script",
        "--oracle",
        "other",
        "--command",
        "true",
      ],
      tmpDir,
    );
    await mustRun(["create", "plan", "--title", "Regression Plan", "--parent", "spec-regression-spec", "--no-ai", ...templatedFieldsArgs("plan")], tmpDir);
    const createResult = await mustRun(
      [
        "create",
        "task",
        "--kind",
        "code",
        "--title",
        "Pre-Rule Task",
        "--parent",
        "plan-regression-plan",
        "--plan-id",
        "plan-regression-plan",
        "--no-ai",
        ...templatedFieldsArgs("task"),
      ],
      tmpDir,
    );
    const taskSlug = extractSlug(createResult.stdout);

    // Verify the fixture actually constructed the state this REGRESSION guards:
    // ac_scope genuinely ABSENT on the created task.
    expect("ac_scope" in (await getDoc(taskSlug, tmpDir)).extra).toBe(false);

    const verifyResult = await runLore(
      ["verify", "plan-regression-plan", "--task", taskSlug, "--ac", "AC-REG-1", "--allow-new-commands"],
      tmpDir,
    );

    expect(verifyResult.exitCode).toBe(0);
    expect(verifyResult.stdout).toContain("AC-REG-1");
    expect(verifyResult.stdout).toContain("pass");

    const evidence = (await getDoc(taskSlug, tmpDir)).extra["verification_evidence"] as
      | Array<Record<string, unknown>>
      | undefined;
    expect(evidence ?? []).toHaveLength(1);
    const attestation = evidence?.[0]?.["attestation"] as Record<string, unknown> | undefined;
    expect(attestation).toBeDefined();
    expect(attestation?.["runner"]).toBe("lore-cli");
    expect(attestation?.["exit_code"]).toBe(0);
  });
});

// ─── AC-ACS-8 — HAPPY (E2E, the whole point) ─────────────────────────────────

describe("lore verify — a task created under this rule is attested end-to-end (AC-ACS-8)", () => {
  it("declares --ac-scope at creation, is verified, and the STORED evidence entry carries an attestation block", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "lore-acscope-e2e-happy-"));
    await mustRun(["init"], tmpDir);

    await mustRun(["create", "prd", "--title", "E2E PRD", "--no-ai", ...templatedFieldsArgs("prd")], tmpDir);
    await mustRun(
      ["create", "spec", "--title", "E2E Spec", "--no-ai", ...templatedFieldsArgs("spec", { kind: "feature" })],
      tmpDir,
    );
    await mustRun(
      [
        "ac",
        "add",
        "spec-e2e-spec",
        "AC-E2E-1",
        "--statement",
        "A dogfood AC.",
        "--mode",
        "script",
        "--oracle",
        "other",
        "--command",
        "true",
      ],
      tmpDir,
    );
    await mustRun(["create", "plan", "--title", "E2E Plan", "--parent", "spec-e2e-spec", "--no-ai", ...templatedFieldsArgs("plan")], tmpDir);

    // Declares --ac-scope AT CREATION TIME — this is the admission rule's
    // whole point: the create path REQUIRES this, unlike the regression
    // fixture above (which disabled the checkpoint to construct the
    // pre-rule state).
    const createResult = await mustRun(
      [
        "create",
        "task",
        "--kind",
        "code",
        "--title",
        "Rule-Compliant Task",
        "--parent",
        "plan-e2e-plan",
        "--plan-id",
        "plan-e2e-plan",
        "--no-ai",
        ...templatedFieldsArgs("task"),
        "--ac-scope",
        "AC-E2E-1",
      ],
      tmpDir,
    );
    const taskSlug = extractSlug(createResult.stdout);
    expect((await getDoc(taskSlug, tmpDir)).extra["ac_scope"]).toEqual(["AC-E2E-1"]);

    const verifyResult = await runLore(["verify", "plan-e2e-plan", "--task", taskSlug, "--allow-new-commands"], tmpDir);

    expect(verifyResult.exitCode).toBe(0);
    expect(verifyResult.stdout).toContain("AC-E2E-1");
    expect(verifyResult.stdout).toContain("pass");

    // Asserted on the STORED entry, never on the zero exit code alone.
    const evidence = (await getDoc(taskSlug, tmpDir)).extra["verification_evidence"] as
      | Array<Record<string, unknown>>
      | undefined;
    expect(evidence ?? []).toHaveLength(1);
    const attestation = evidence?.[0]?.["attestation"] as Record<string, unknown> | undefined;
    expect(attestation).toBeDefined();
    expect(attestation?.["runner"]).toBe("lore-cli");
    expect(attestation?.["exit_code"]).toBe(0);
    expect(attestation?.["timed_out"]).toBe(false);
    expect(evidence?.[0]?.["ac_ref"]).toBe("AC-E2E-1");
  });
});
