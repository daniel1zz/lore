// @reads assets/governance/write-spec-rule.md
// @reads assets/project/lore-config-template.yaml
/**
 * `lore done --override-attestation "<reason>"` — the CLI end-to-end oracle for
 * adr-lore-done-requires-a-runner-attested-pass-the-sixth-false /
 * task-lore-done-accepts-an-unattested-self-reported-pass-as, under the done-contract model
 * (spec-done-contract-compiled-at-approve-task-kinds-write-sets, AC-DCS1-7).
 *
 * Proves the flag reaches the command end to end — argv parsing → `TaskWorkflowService.done` → the floors — not just the service
 * layer (covered by task-workflow-service.test.ts's "attested-pass floor" and "escape hatch" suites). `lore done` now judges a task
 * only by the contract stored at approve, in the fixed floor order of BR-209: the override waives the ATTESTED-PASS floor and
 * nothing after it, so a task whose contract oracle has no counted pass is still refused, at the first oracle floor
 * ([floor: unfiltered-test-file] for an anchored test file, then [floor: contract-oracles]).
 *
 * Two fixtures, by what each case needs:
 *   - a planless `--adhoc` code task holding no contract, for the cases the command refuses BEFORE any floor (a usage error);
 *   - {@link makeOverrideWorld}: a real repository where a code task is approved (red waived), claimed on a branch in a linked
 *     worktree, committed on and landed on main, for the cases that reach the floors.
 * Both are throwaway (mkdtemp + `lore init`, HOME outside the repository); this repository's own `.lore/` is never touched.
 *
 * Retired with the model (spec AC-DCS1-6, named in the commit): the `--declare-no-new-tests` companion flag these cases used to
 * carry, and every case that archived a task through the override alone. After an override the contract oracles are judged by
 * counted passes, so no task with a compiled contract is archived by an override; the audit-stamping of an archive through the
 * override is covered at the service layer by a contract that holds no oracle (task-workflow-service.test.ts).
 *
 * Coverage:
 *   NEGATIVE:   a blank/whitespace reason is a CLI usage error (exit 2), BEFORE the corpus is touched
 *   BOUNDARY:   a reason with internal whitespace is accepted by the parser and reaches the floors, and the oracle floors
 *               refuse it (exit 4) with nothing written
 *   STATE:      the override NEVER stamps an audit row when the floors refuse (override_reason / attestation_overridden
 *               absent), with a control task that never used the flag
 *   ERROR:      omitting the flag on an unevidenced landed task refuses at attested-pass (exit 4), naming both repairs
 *   REGRESSION: `lore done` on an ALREADY-archived task is still an idempotent no-op (exit 0) with a stray
 *               `--override-attestation` attached — the terminal short-circuit stays evaluated before every floor
 *
 * @spec_ref adr-lore-done-requires-a-runner-attested-pass-the-sixth-false
 * @spec_ref task-lore-done-accepts-an-unattested-self-reported-pass-as
 * @spec_ref spec-done-contract-compiled-at-approve-task-kinds-write-sets
 *
 * TG-25 (adr-tg-1 option b): the commands run IN-PROCESS through tests/helpers/run-lore-in-process.ts, not through dist/lore.
 */

import { describe, expect, it, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
const setDefaultTimeout = (ms: number): void => { vi.setConfig({ testTimeout: ms, hookTimeout: ms }); };
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { runLoreInProcess } from "../../helpers/run-lore-in-process";
import { makeCleanTreeRepo } from "../../helpers/clean-tree-repo";
import { makeOverrideWorld, type OverrideWorld } from "./done-override-world";

setDefaultTimeout(180_000);

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

async function mustRun(args: string[], cwd: string): Promise<RunResult> {
  const result = await runLore(args, cwd);
  if (result.exitCode !== 0) {
    throw new Error(`fixture command \`lore ${args.join(" ")}\` failed (${result.exitCode}): ${result.stderr}`);
  }
  return result;
}

interface DocJson {
  readonly slug: string;
  readonly status: string;
  readonly version: number;
  readonly extra: Record<string, unknown>;
}

async function getDoc(slug: string, cwd: string): Promise<DocJson> {
  const result = await mustRun(["get", slug, "--json"], cwd);
  return (JSON.parse(result.stdout) as { data: { doc: DocJson } }).data.doc;
}

/**
 * Creates a planless (`--adhoc`) code task and returns its slug. `--ac-scope ""` is required on the ad-hoc branch; the task holds
 * no contract (it was never approved), which is all the usage-error cases need.
 */
async function createAdhocTask(cwd: string, title: string): Promise<string> {
  const created = await mustRun(
    ["create", "task", "--title", title, "--kind", "code", "--adhoc", "--ac-scope", "", "--content", "body", "--no-ai", "--json"],
    cwd,
  );
  return (JSON.parse(created.stdout) as { data: { slug: string } }).data.slug;
}

/** Records one SELF-REPORTED (never attested) passing evidence row — the shape every `lore evidence` write without `--capture` produces. */
async function recordSelfReportedPass(slug: string, cwd: string): Promise<void> {
  // reason: "manual" is the one oracle whose self-reported pass with a non-empty tail is accepted at write time while staying
  // unattested, which is what this suite's attestation-floor assertions need.
  await mustRun(
    ["evidence", slug, "--oracle", "manual", "--command", "bun run typecheck", "--result", "pass", "--output-tail", "ok"],
    cwd,
  );
}

let tmpDir: string;

beforeEach(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "lore-cli-done-escape-hatch-"));
  // a claim's recorded worktree is measured through `git worktree list` (BR-1353), so the fixture is a git repository
  makeCleanTreeRepo(tmpDir);
  await mustRun(["init"], tmpDir);
  // An --adhoc task parents to the corpus root PRD (CorpusService._createImpl) — one must exist first.
  await mustRun(["create", "prd", "--title", "Escape Hatch Root", "--content", "## Overview\nroot", "--no-ai"], tmpDir);
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

describe("NEGATIVE — a blank/whitespace reason is a CLI usage error (exit 2), before the corpus is touched", () => {
  it("an empty-string reason exits 2 and leaves the task's status/evidence untouched", async () => {
    const slug = await createAdhocTask(tmpDir, "Blank Reason Task");
    await recordSelfReportedPass(slug, tmpDir);
    const before = await getDoc(slug, tmpDir);

    const result = await runLore(["done", slug, "--override-attestation", ""], tmpDir);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--override-attestation");

    const after = await getDoc(slug, tmpDir);
    expect(after.status).toBe(before.status);
    expect(after.version).toBe(before.version);
  });

  it("a whitespace-only reason ('   ') is refused identically", async () => {
    const slug = await createAdhocTask(tmpDir, "Whitespace Reason Task");
    await recordSelfReportedPass(slug, tmpDir);

    const result = await runLore(["done", slug, "--override-attestation", "   "], tmpDir);
    expect(result.exitCode).toBe(2);
    expect((await getDoc(slug, tmpDir)).status).toBe("draft"); // unchanged — never archived
  });
});

describe("STATE — a task that never used the flag carries no override marker on any audit row (CONTROL)", () => {
  it("the claim/evidence/release rows of a normal EXECUTE loop never carry override_reason or attestation_overridden", async () => {
    // reason: those keys are written ONLY by the done() escape-hatch path, never stamped ambiently onto a row. A refused done
    // writes nothing, so the control asserts on the claim/evidence/release rows a normal loop produces.
    const slug = await createAdhocTask(tmpDir, "Unaudited Control Task");
    await mustRun(["claim", slug, "--worktree", "control-branch"], tmpDir);
    await recordSelfReportedPass(slug, tmpDir);
    await mustRun(["release", slug], tmpDir);

    // The done() call is refused (the task holds no contract) — exit 4, never reaching the audit-stamping code path.
    const refusal = await runLore(["done", slug], tmpDir);
    expect(refusal.exitCode).toBe(4);

    const audit = await mustRun(["audit", slug, "--json"], tmpDir);
    const entries = (JSON.parse(audit.stdout) as { data: { entries: Array<{ details?: Record<string, unknown> }> } }).data.entries;
    expect(entries.length).toBeGreaterThan(0); // claim/release/evidence rows exist
    expect(entries.every((e) => e.details?.["override_reason"] === undefined)).toBe(true);
    expect(entries.every((e) => e.details?.["attestation_overridden"] === undefined)).toBe(true);
  });
});

describe("the escape on a landed code task with a stored contract (real repository, linked worktree)", () => {
  let world: OverrideWorld;

  beforeAll(async () => {
    world = await makeOverrideWorld();
  });

  afterAll(() => {
    world.dispose();
  });

  it("ERROR: omitting the flag on an unevidenced landed task refuses [floor: attested-pass] (exit 4), naming both repairs, task unchanged", async () => {
    const slug = await world.landTask("No Escape Hatch Task");
    const before = await world.readTask(slug);

    const result = await world.run(["done", slug]);
    expect(result.exitCode).toBe(4);
    expect(result.stderr).toContain("[floor: attested-pass]");
    expect(result.stderr).toContain("lore verify");
    expect(result.stderr).toContain("--override-attestation");

    const after = await world.readTask(slug);
    expect(after.status).toBe(before.status);
    expect(after.version).toBe(before.version);
  });

  it("BOUNDARY: a multi-word reason is accepted by the parser, waives only the attestation floor, and is refused at the next floor ([floor: unfiltered-test-file]) with nothing written", async () => {
    const slug = await world.landTask("Multiword Reason Task");
    await world.mustRun(["evidence", slug, "--oracle", "manual", "--command", "bun run typecheck", "--result", "pass", "--output-tail", "ok"]);
    const before = await world.readTask(slug);
    const REASON = "manual browser check: verified in staging, screenshot attached to PR #123";

    const result = await world.run(["done", slug, "--override-attestation", REASON]);
    expect(result.exitCode).toBe(4);
    // the landed task anchors one test file, so its contract holds a `test:` oracle, which is judged right after the red run
    expect(result.stderr).toContain("[floor: unfiltered-test-file]");
    expect(result.stderr).toContain("tests/o-");
    expect(result.stderr).not.toContain("[floor: attested-pass]");

    const after = await world.readTask(slug);
    expect(after.status).toBe(before.status);
    expect(after.version).toBe(before.version);
    // the refusal wrote nothing, so no audit row carries the reason or the override marker
    const rows = await world.auditRows(slug);
    expect(rows.every((row) => row.details?.["override_reason"] === undefined)).toBe(true);
    expect(rows.every((row) => row.details?.["attestation_overridden"] === undefined)).toBe(true);
  });

  it("REGRESSION: an already-archived task stays an idempotent no-op with a stray override flag (exit 0, no new audit row)", async () => {
    const slug = await world.landTask("Already Archived Task");
    await world.attestAllOracles(slug);
    const first = await world.run(["done", slug]);
    expect(first.exitCode, `${first.stdout}${first.stderr}`).toBe(0);
    expect((await world.readTask(slug)).status).toBe("archived");
    const auditCountAfterFirst = (await world.auditRows(slug)).length;

    const second = await world.run(["done", slug, "--override-attestation", "second call, should be a pure no-op"]);
    expect(second.exitCode).toBe(0);
    expect((await world.readTask(slug)).status).toBe("archived");
    // idempotent no-op writes NOTHING — the audit table must not have grown.
    expect((await world.auditRows(slug)).length).toBe(auditCountAfterFirst);
  });
});
