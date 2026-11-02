// @reads assets/project/lore-config-template.yaml
// @reads .lore/config.yaml
/**
 * done-contract-migrate-compiled.bun.test.ts — `lore migrate done-contract` observed through the `lore` command tree on a
 * throwaway repository and corpus (spec-done-contract-compiled-at-approve-task-kinds-write-sets, AC-DCS1-22, AC-DCS1-23).
 *
 * This file grows task by task; it holds the criteria of the tasks before and including the one that owns the newest block, so
 * it passes whole at every task's tip. Each test name starts with `AC-DCS1-<n>:` (with the colon) so `-t 'AC-DCS1-2:'` never
 * matches AC-DCS1-22.
 *
 *   Task "lore migrate done-contract compiles contracts for in-flight tasks, preview first":
 *     AC-DCS1-22  the preview infers kinds, lists causes and corrections, writes nothing
 *     AC-DCS1-23  the apply is all or nothing, stores every contract in one transaction, releases no-branch claims
 *
 * Oracle: the command tree in-process (`runLoreInProcess`) over `mkdtemp` + `lore init` in a clean git repository, HOME outside
 * every repository. The "old" tasks (approved before the contract existed) are written straight into the throwaway corpus
 * through the one write route, because approve now always compiles. The repository's own `.lore/` is only READ, never written.
 *
 * Coverage: HAPPY / NEGATIVE / BOUNDARY / ERROR / STATE / REGRESSION
 */

import { afterAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../src/app";
import { SQLiteStore } from "../../src/store/sqlite-store";
import { CorpusService, type DocWritePort } from "../../src/service/corpus-service";
import { GateEnforcer } from "../../src/service/gate-enforcer";
import { RecordLockService } from "../../src/service/record-lock-service";
import { DoneContractService } from "../../src/service/done-contract-service";
import { createRealDoneContractGit } from "../../src/adapters/real-done-contract-git";
import { LIVE_TEST_RUN, actedStore, liveAmbient, liveWriteContext } from "../live-invocation";
import { DONE_CONTRACT_CONFIG, makeDoneContractFixture, type DoneContractFixture } from "../helpers/done-contract-fixture";
import { dropLoreConfigKey, patchLoreConfig } from "../helpers/patch-lore-config";
import { registerRunInDb } from "../helpers/test-run-identity";

vi.setConfig({ testTimeout: 180_000, hookTimeout: 240_000 });

const fixtures: DoneContractFixture[] = [];
const scratches: string[] = [];
afterAll(() => {
  for (const fixture of fixtures) fixture.dispose();
  for (const scratch of scratches) rmSync(scratch, { recursive: true, force: true });
});

const WAIVER = "7 steps -- with  spaces = and a dash";
const NOW = "2026-01-01T00:00:00.000Z";

interface Seed {
  readonly title: string;
  readonly kind?: string;
  readonly anchors?: readonly string[];
  readonly acScope?: readonly string[];
  readonly claim?: Record<string, unknown>;
  readonly claimAudit?: Record<string, unknown>;
  readonly evidence?: readonly Record<string, unknown>[];
  readonly landing?: Record<string, unknown>;
}

/** One evidence row; `runner` marks it produced by a runner (a captured run), else it is a self-report. */
function evidenceRow(result: "pass" | "expected-fail", runner: boolean): Record<string, unknown> {
  return { oracle: "test", command: "bun run test:file x", result, recorded_at: NOW, recorded_by: "agent:legacy", capture_source: runner ? "runner" : "self-report" };
}

/** Writes an APPROVED task as the old protocol left it: no contract, maybe no kind, maybe a claim. Returns its slug. */
async function seedLegacyTask(fixture: DoneContractFixture, planSlug: string, seed: Seed): Promise<string> {
  const app = createApp(join(fixture.dir, ".lore", "lore.db"), undefined, liveAmbient(), liveWriteContext());
  try {
    const plan = await app.corpusService.get(planSlug);
    if (!plan.ok) throw new Error(`seed: plan ${planSlug} not found`);
    const extra: Record<string, unknown> = {
      plan_id: plan.value.doc.id,
      ac_scope: [...(seed.acScope ?? [])],
      ...(seed.anchors !== undefined ? { file_anchors: [...seed.anchors] } : {}),
      ...(seed.kind !== undefined ? { kind: seed.kind } : {}),
      ...(seed.claim !== undefined ? { claim: seed.claim } : {}),
      ...(seed.evidence !== undefined ? { verification_evidence: [...seed.evidence] } : {}),
      ...(seed.landing !== undefined ? { landing: seed.landing } : {}),
    };
    const created = await app.corpusService.create({ type: "task", title: seed.title, content: "## Task\n\nApproved before the contract existed.\n", parent_id: plan.value.doc.id, extra });
    if (!created.ok) throw new Error(`seed: create failed: ${JSON.stringify(created.error)}`);
    const moved = await app.corpusService.writeDoc({ doc: created.value, patch: { status: "approved" }, action: "update", auditAction: "update", lock: "none" });
    if (!moved.ok) throw new Error(`seed: approve-write failed: ${JSON.stringify(moved.error)}`);
    if (seed.claimAudit !== undefined) {
      const audited = await app.corpusService.appendAudit({ action: "claim", sessionId: `seed-${created.value.id}`, docId: created.value.id, details: seed.claimAudit });
      if (!audited.ok) throw new Error(`seed: claim audit failed: ${JSON.stringify(audited.error)}`);
    }
    return created.value.slug;
  } finally {
    app.close();
  }
}

/** Replaces `extra` keys of an existing task through the one write route (a stand-in for the user's correction of a gap). */
async function patchTaskExtra(fixture: DoneContractFixture, slug: string, patch: Record<string, unknown>, remove: readonly string[] = []): Promise<void> {
  const app = createApp(join(fixture.dir, ".lore", "lore.db"), undefined, liveAmbient(), liveWriteContext());
  try {
    const found = await app.corpusService.get(slug);
    if (!found.ok) throw new Error(`patch: ${slug} not found`);
    const extra: Record<string, unknown> = { ...found.value.doc.extra, ...patch };
    for (const key of remove) delete extra[key];
    const written = await app.corpusService.writeDoc({ doc: found.value.doc, patch: { extra }, action: "update", auditAction: "update", lock: "none" });
    if (!written.ok) throw new Error(`patch failed: ${JSON.stringify(written.error)}`);
  } finally {
    app.close();
  }
}

interface Legacy {
  readonly fixture: DoneContractFixture;
  readonly plan: string;
  readonly head: string;
  readonly slugs: {
    readonly codeAnchor: string;
    readonly branchRed: string;
    readonly check: string;
    readonly corpus: string;
    readonly noBranch: string;
    readonly needsWaiver: string;
    readonly badCheck: string;
    readonly liveBranch: string;
    readonly goneBranch: string;
  };
}

/** The corpus of an older project: one task of every inferred kind and one of every gap. */
async function buildLegacy(): Promise<Legacy> {
  const fixture = await makeDoneContractFixture();
  fixtures.push(fixture);
  // The legacy task anchors a test file; the migration compiles like approve, which refuses an absent undeclared test anchor (BR-1547).
  mkdirSync(join(fixture.dir, "tests"), { recursive: true });
  writeFileSync(join(fixture.dir, "tests", "a.test.ts"), "// seed\n");
  fixture.git(["add", "-A"]);
  fixture.git(["commit", "-q", "-m", "seed the anchored test file"]);
  const plan = await fixture.createPlan("Legacy plan");
  fixture.git(["branch", "feat-legacy"]);
  const head = fixture.git(["rev-parse", "HEAD"]);
  const branchClaim = { by: "agent:legacy", at: NOW, harness_run: "cc:legacy", branch: "feat-legacy", worktree: "/nonexistent/legacy-wt", start_head: head };
  const slugs = {
    codeAnchor: await seedLegacyTask(fixture, plan, { title: "Code by anchors", anchors: ["src/a.ts", "tests/a.test.ts"] }),
    branchRed: await seedLegacyTask(fixture, plan, {
      title: "Anchorless task with a branch claim",
      claimAudit: { branch: "feat-legacy", worktree: "/nonexistent/legacy-wt", base_sha: head },
      evidence: [evidenceRow("expected-fail", true)],
    }),
    check: await seedLegacyTask(fixture, plan, { title: "Check by script AC", acScope: ["AC-FX-1"] }),
    corpus: await seedLegacyTask(fixture, plan, { title: "Corpus without script AC" }),
    noBranch: await seedLegacyTask(fixture, plan, { title: "Holds a claim naming no branch", claim: { by: "agent:legacy", at: NOW, harness_run: "cc:legacy", start_head: head } }),
    needsWaiver: await seedLegacyTask(fixture, plan, { title: "Code with evidence and no red", anchors: ["src/b.ts"], evidence: [evidenceRow("pass", false)] }),
    badCheck: await seedLegacyTask(fixture, plan, { title: "Check with no oracle", kind: "check" }),
    liveBranch: await seedLegacyTask(fixture, plan, { title: "Uncompilable with a live branch claim", kind: "check", claim: branchClaim, claimAudit: { branch: "feat-legacy", worktree: "/nonexistent/legacy-wt", base_sha: head } }),
    goneBranch: await seedLegacyTask(fixture, plan, {
      title: "Branch gone, tip unknown",
      claimAudit: { branch: "gone-branch", worktree: "/nonexistent/gone-wt", base_sha: head },
      evidence: [evidenceRow("expected-fail", true)],
    }),
  };
  return { fixture, plan, head, slugs };
}

interface Snapshot {
  readonly version: number;
  readonly status: string;
  readonly extra: string;
}

async function snapshotOf(fixture: DoneContractFixture, slugs: readonly string[]): Promise<Record<string, Snapshot>> {
  const out: Record<string, Snapshot> = {};
  for (const slug of slugs) {
    const task = await fixture.readTask(slug);
    out[slug] = { version: task.version, status: task.status, extra: JSON.stringify(task.extra) };
  }
  return out;
}

interface JsonTask {
  readonly slug: string;
  readonly kind: string | null;
  readonly kind_source: string;
  readonly releases_claim: boolean;
  readonly contract: { oracles: { id: string; command?: string }[]; red_required: boolean; red_waiver_reason?: string; landing_route: string; kind: string } | null;
  readonly gaps: { code: string; message: string; fill: string }[];
}

function tasksOf(stdout: string): Record<string, JsonTask> {
  const parsed = JSON.parse(stdout) as { data: { tasks: JsonTask[] } };
  return Object.fromEntries(parsed.data.tasks.map((task) => [task.slug, task]));
}

function openRaw(fixture: DoneContractFixture): SQLiteStore {
  const dbPath = join(fixture.dir, ".lore", "lore.db");
  registerRunInDb(dbPath, LIVE_TEST_RUN);
  return new SQLiteStore(dbPath);
}

describe("AC-DCS1-22: the preview infers kinds, lists causes and corrections, and writes nothing", () => {
  it("AC-DCS1-22: lists every approved task with its inferred kind, its contract or its gaps with the command that fills each, and writes nothing", async () => {
    const legacy = await buildLegacy();
    const { fixture, slugs } = legacy;
    const all = Object.values(slugs);
    const before = await snapshotOf(fixture, all);

    const preview = await fixture.run(["migrate", "done-contract", "--json"]);
    // A gap is a finding to act on: exit 4 (unlike the other previews), with the full listing still on stdout.
    expect(preview.exitCode, preview.stderr + preview.stdout).toBe(4);
    const tasks = tasksOf(preview.stdout);

    // Each of the three inferred kinds, and why.
    expect(tasks[slugs.codeAnchor]).toMatchObject({ kind: "code", kind_source: "inferred" });
    expect(tasks[slugs.branchRed]).toMatchObject({ kind: "code", kind_source: "inferred" }); // anchorless, but a claim named a branch
    expect(tasks[slugs.check]).toMatchObject({ kind: "check", kind_source: "inferred" });
    expect(tasks[slugs.corpus]).toMatchObject({ kind: "corpus", kind_source: "inferred" });
    expect(tasks[slugs.noBranch]).toMatchObject({ kind: "corpus", kind_source: "inferred" });

    // The contract each compilable task would get: exactly what approve compiles (oracle ids and routes).
    expect(tasks[slugs.codeAnchor]?.contract?.oracles.map((oracle) => oracle.id)).toEqual(["test:tests/a.test.ts", "typecheck"]);
    expect(tasks[slugs.codeAnchor]?.contract?.red_required).toBe(true);
    expect(tasks[slugs.check]?.contract?.oracles.map((oracle) => oracle.id)).toEqual(["ac:AC-FX-1"]);
    expect(tasks[slugs.check]?.contract?.landing_route).toBe("none");
    expect(tasks[slugs.corpus]?.contract?.oracles.map((oracle) => oracle.id)).toEqual(["corpus:files-unchanged"]);
    // A task that already holds a runner-produced red row needs no waiver.
    expect(tasks[slugs.branchRed]?.gaps).toEqual([]);
    expect(tasks[slugs.branchRed]?.contract?.red_required).toBe(true);

    // The no-branch claim is listed as to be released.
    expect(tasks[slugs.noBranch]?.releases_claim).toBe(true);
    expect(tasks[slugs.check]?.releases_claim).toBe(false);

    // Each gap, with the command that fills it.
    expect(tasks[slugs.needsWaiver]?.gaps.map((gap) => gap.code)).toEqual(["needs-red-waiver"]);
    expect(tasks[slugs.needsWaiver]?.gaps[0]?.fill).toBe(`lore migrate done-contract --apply --red-waiver ${slugs.needsWaiver}="<reason>"`);
    expect(tasks[slugs.goneBranch]?.gaps.map((gap) => gap.code)).toEqual(["unknown-tip"]);
    expect(tasks[slugs.goneBranch]?.gaps[0]?.fill).toBe(`lore migrate done-contract --apply --tip ${slugs.goneBranch}=<commit>`);
    expect(tasks[slugs.badCheck]?.gaps.map((gap) => gap.code)).toEqual(["uncompilable"]);
    expect(tasks[slugs.badCheck]?.gaps[0]?.message).toContain("no-oracle");
    expect(tasks[slugs.badCheck]?.gaps[0]?.fill).toContain(`lore set ${slugs.badCheck} --correction`);
    expect(tasks[slugs.badCheck]?.gaps[0]?.fill).toContain(`lore approve ${slugs.badCheck}`);
    expect(tasks[slugs.liveBranch]?.gaps.map((gap) => gap.code)).toEqual(["uncompilable", "live-branch-claim"]);

    // The human rendering names the same commands.
    const human = await fixture.run(["migrate", "done-contract"]);
    expect(human.exitCode).toBe(4);
    expect(human.stdout).toContain(`--red-waiver ${slugs.needsWaiver}=`);
    expect(human.stdout).toContain("to be released");

    // False green guarded: a preview that wrote would pass the content checks above, so every version, status and extra is compared.
    expect(await snapshotOf(fixture, all)).toEqual(before);
    for (const slug of all) expect((await fixture.readTask(slug)).extra["done_contract"]).toBeUndefined();
  });

  it("AC-DCS1-22: the preview exits 0 once every task compiles, applies the decisions it is given without writing, and a config key is a gap with its key named", async () => {
    const legacy = await buildLegacy();
    const { fixture, slugs } = legacy;
    // Drop the three unfixable-by-flag tasks as the user's own corrections would (the migration never moves a task).
    await patchTaskExtra(fixture, slugs.badCheck, { ac_scope: ["AC-FX-1"] });
    await patchTaskExtra(fixture, slugs.liveBranch, { ac_scope: ["AC-FX-1"] });
    const all = Object.values(slugs);
    const before = await snapshotOf(fixture, all);

    const gapsLeft = await fixture.run(["migrate", "done-contract", "--json"]);
    expect(gapsLeft.exitCode, gapsLeft.stderr).toBe(4);
    const decided = await fixture.run([
      "migrate", "done-contract", "--json",
      "--red-waiver", `${slugs.needsWaiver}=${WAIVER}`,
      "--tip", `${slugs.goneBranch}=${legacy.head}`,
    ]);
    expect(decided.exitCode, decided.stderr + decided.stdout).toBe(0);
    const tasks = tasksOf(decided.stdout);
    expect(Object.values(tasks).every((task) => task.gaps.length === 0)).toBe(true);
    expect(tasks[slugs.needsWaiver]?.contract?.red_required).toBe(false);
    expect(tasks[slugs.needsWaiver]?.contract?.red_waiver_reason).toBe(WAIVER);
    expect(await snapshotOf(fixture, all)).toEqual(before);

    // A missing config key is a gap naming the key to set.
    dropLoreConfigKey(fixture.dir, ["workflow", "done_contract", "typecheck"]);
    const missingKey = await fixture.run(["migrate", "done-contract", "--json", "--red-waiver", `${slugs.needsWaiver}=${WAIVER}`, "--tip", `${slugs.goneBranch}=${legacy.head}`]);
    expect(missingKey.exitCode, missingKey.stderr).toBe(4);
    const keyGaps = tasksOf(missingKey.stdout)[slugs.codeAnchor]?.gaps ?? [];
    expect(keyGaps.map((gap) => gap.code)).toEqual(["config-key"]);
    expect(keyGaps[0]?.fill).toBe("set workflow.done_contract.typecheck in .lore/config.yaml");
    expect(await snapshotOf(fixture, all)).toEqual(before);
  });
});

describe("AC-DCS1-23: the apply is all or nothing, one transaction, and converts the old claims", () => {
  it("AC-DCS1-23: with a gap the other tasks are still stored, every gapped task is listed with its command, the exit is 4, and claim and done of a gapped task refuse contract-missing", async () => {
    const fixture = await makeDoneContractFixture();
    fixtures.push(fixture);
    const plan = await fixture.createPlan("Per-task plan");
    const a =await seedLegacyTask(fixture, plan, { title: "A compilable", acScope: ["AC-FX-1"] });
    const b = await seedLegacyTask(fixture, plan, { title: "B needs a red waiver", anchors: ["src/b.ts"], evidence: [evidenceRow("pass", false)] });
    const c = await seedLegacyTask(fixture, plan, { title: "C anchors an absent test", anchors: ["tests/absent.test.ts"], evidence: [evidenceRow("expected-fail", true)] });
    const all = [a, b, c];
    const before = await snapshotOf(fixture, all);

    const first = await fixture.run(["migrate", "done-contract", "--apply"]);
    expect(first.exitCode, first.stderr + first.stdout).toBe(4);
    const text = `${first.stdout}\n${first.stderr}`;
    expect(text).toContain(`--red-waiver ${b}=`);
    expect(text).toContain("anchor-absent");
    expect(text).toContain("tests/absent.test.ts");
    expect(text).toContain(`lore anchor rm ${c} tests/absent.test.ts`);
    expect(text).toContain("--creates");

    // False green guarded: the all-or-nothing apply stores nothing for A while B and C are gapped; A is claimable after the run.
    expect((await fixture.readTask(a)).extra["done_contract"]).toBeDefined();
    expect((await fixture.readTask(b)).extra["done_contract"]).toBeUndefined();
    expect((await fixture.readTask(c)).extra["done_contract"]).toBeUndefined();
    expect((await snapshotOf(fixture, [b, c]))[b]).toEqual(before[b]);
    expect((await snapshotOf(fixture, [b, c]))[c]).toEqual(before[c]);
    const afterA = await snapshotOf(fixture, [a]);
    // A check task is never claimed (AC-DCS1-21), so "A is usable" is its stored contract and its unchanged status.
    expect((await fixture.readTask(a)).status).toBe("approved");

    for (const verb of [["claim", b], ["done", b], ["claim", c], ["done", c]]) {
      const refused = await fixture.run(verb);
      expect(refused.exitCode, `${verb.join(" ")}: ${refused.stderr}`).toBe(4);
      expect(refused.stderr, verb.join(" ")).toContain("contract-missing");
      expect(refused.stderr, verb.join(" ")).toContain("lore migrate done-contract");
    }

    // A decision for a task that does not list that gap is refused; nothing is written.
    const notNeeded = await fixture.run(["migrate", "done-contract", "--apply", "--red-waiver", `${a}=not needed`]);
    expect(notNeeded.exitCode, notNeeded.stderr).toBe(4);
    expect(notNeeded.stderr).toContain("decision-not-needed");

    // The waiver and the anchor removal fill both gaps: B and C are stored and A's contract version is unchanged.
    await fixture.mustRun(["anchor", "rm", c, "tests/absent.test.ts"]);
    const second = await fixture.run(["migrate", "done-contract", "--apply", "--red-waiver", `${b}=${WAIVER}`]);
    expect(second.exitCode, second.stderr + second.stdout).toBe(0);
    expect((await fixture.readTask(b)).extra["done_contract"]).toBeDefined();
    expect((await fixture.readTask(c)).extra["done_contract"]).toBeDefined();
    expect((await snapshotOf(fixture, [a]))[a]?.version).toBe(afterA[a]?.version);

    const stored = await snapshotOf(fixture, all);
    const third = await fixture.run(["migrate", "done-contract", "--apply"]);
    expect(third.exitCode, third.stderr + third.stdout).toBe(0);
    expect(await snapshotOf(fixture, all)).toEqual(stored);
  });

  it("AC-DCS1-23: a decision outside the three kinds, a blank reason or an unresolvable commit exits 2; a decision for a task that does not list that gap exits 4 decision-not-needed; nothing is written", async () => {
    const legacy = await buildLegacy();
    const { fixture, slugs } = legacy;
    const all = Object.values(slugs);
    const before = await snapshotOf(fixture, all);

    const badKind = await fixture.run(["migrate", "done-contract", "--apply", "--kind", `${slugs.corpus}=document`]);
    expect(badKind.exitCode, badKind.stderr).toBe(2);
    const blank = await fixture.run(["migrate", "done-contract", "--apply", "--red-waiver", `${slugs.needsWaiver}=   `]);
    expect(blank.exitCode, blank.stderr).toBe(2);
    const badTip = await fixture.run(["migrate", "done-contract", "--apply", "--tip", `${slugs.goneBranch}=0123456789abcdef0123456789abcdef01234567`]);
    expect(badTip.exitCode, badTip.stderr).toBe(2);

    // A slug that is not listed for that gap: the check task has no red to waive, the code task has no tip gap, an unknown slug is no task.
    for (const flags of [
      ["--red-waiver", `${slugs.check}=not needed`],
      ["--tip", `${slugs.codeAnchor}=${legacy.head}`],
      ["--red-waiver", "task-that-does-not-exist=not needed"],
    ]) {
      const result = await fixture.run(["migrate", "done-contract", "--apply", ...flags]);
      expect(result.exitCode, result.stderr).toBe(4);
      expect(result.stderr, flags.join(" ")).toContain("decision-not-needed");
    }
    expect(await snapshotOf(fixture, all)).toEqual(before);
  });

  it("AC-DCS1-23: with every gap filled it stores every contract in one transaction as approve would, releases the no-branch claim, and a second apply writes nothing", async () => {
    const legacy = await buildLegacy();
    const { fixture, slugs } = legacy;
    // The two corrections the migration only names (an audited correction of the task, here its stand-in).
    await patchTaskExtra(fixture, slugs.badCheck, { ac_scope: ["AC-FX-1"] });
    await patchTaskExtra(fixture, slugs.liveBranch, { ac_scope: ["AC-FX-1"] });
    const all = Object.values(slugs);
    const before = await snapshotOf(fixture, all);

    const applied = await fixture.run([
      "migrate", "done-contract", "--apply", "--json",
      "--red-waiver", `${slugs.needsWaiver}=${WAIVER}`,
      "--tip", `${slugs.goneBranch}=${legacy.head}`,
    ]);
    expect(applied.exitCode, applied.stderr + applied.stdout).toBe(0);

    // Every task holds a contract, with its kind stored, and was written exactly once (one version each).
    const after = await Promise.all(all.map((slug) => fixture.readTask(slug)));
    for (const task of after) {
      expect(task.extra["done_contract"], task.slug).toBeDefined();
      expect(task.status, task.slug).toBe("approved");
      expect(task.version, task.slug).toBe((before[task.slug]?.version ?? 0) + 1);
    }
    const bySlug = Object.fromEntries(after.map((task) => [task.slug, task]));
    expect(bySlug[slugs.codeAnchor]?.extra["kind"]).toBe("code");
    expect(bySlug[slugs.check]?.extra["kind"]).toBe("check");
    expect(bySlug[slugs.corpus]?.extra["kind"]).toBe("corpus");
    // The waiver is read back byte for byte.
    expect((bySlug[slugs.needsWaiver]?.extra["done_contract"] as { red_required: boolean; red_waiver_reason: string }).red_required).toBe(false);
    expect((bySlug[slugs.needsWaiver]?.extra["done_contract"] as { red_waiver_reason: string }).red_waiver_reason).toBe(WAIVER);
    // The claim that names no branch is released; the branch claim is kept.
    expect(bySlug[slugs.noBranch]?.extra["claim"]).toBeUndefined();
    expect(bySlug[slugs.liveBranch]?.extra["claim"]).toBeDefined();

    // The release has an audit row naming the migration; the tip decision is recorded as a release row carrying end_tip.
    const raw = openRaw(fixture);
    try {
      const released = await raw.queryAudit({ doc_id: bySlug[slugs.noBranch]?.id as never, action: "release" });
      expect(released.ok && released.value.some((row) => row.details?.["operation"] === "done-contract-migrate"), JSON.stringify(released)).toBe(true);
      const tipRows = await raw.queryAudit({ doc_id: bySlug[slugs.goneBranch]?.id as never, action: "release" });
      expect(tipRows.ok && tipRows.value.some((row) => row.details?.["end_tip"] === legacy.head), JSON.stringify(tipRows)).toBe(true);
    } finally {
      raw.close();
    }

    // The migration compiles the way approve does: twins approved through `lore approve` store the identical contract.
    const twinCheck = await fixture.createTask({ plan: legacy.plan, kind: "check", acScope: ["AC-FX-1"], title: "Twin check" });
    await fixture.mustRun(["approve", twinCheck]);
    expect((await fixture.readTask(twinCheck)).extra["done_contract"]).toEqual(bySlug[slugs.check]?.extra["done_contract"]);
    const twinCode = await fixture.createTask({ plan: legacy.plan, kind: "code", anchors: ["src/b.ts"], title: "Twin code" });
    await fixture.mustRun(["approve", twinCode, "--red-waiver", WAIVER]);
    expect((await fixture.readTask(twinCode)).extra["done_contract"]).toEqual(bySlug[slugs.needsWaiver]?.extra["done_contract"]);

    // A second apply writes nothing.
    const stored = await snapshotOf(fixture, all);
    const again = await fixture.run(["migrate", "done-contract", "--apply", "--json"]);
    expect(again.exitCode, again.stderr + again.stdout).toBe(0);
    expect(await snapshotOf(fixture, all)).toEqual(stored);
  });

  it("AC-DCS1-23: a write failure injected midway leaves nothing: no contract, no version and the claim still held", async () => {
    const fixture = await makeDoneContractFixture();
    fixtures.push(fixture);
    const plan = await fixture.createPlan("Atomic plan");
    const head = fixture.git(["rev-parse", "HEAD"]);
    const first = await seedLegacyTask(fixture, plan, { title: "Atomic check", acScope: ["AC-FX-1"] });
    const second = await seedLegacyTask(fixture, plan, { title: "Atomic corpus with claim", claim: { by: "agent:legacy", at: NOW, harness_run: "cc:legacy", start_head: head } });
    const third = await seedLegacyTask(fixture, plan, { title: "Atomic corpus" });
    const slugs = [first, second, third];
    const before = await snapshotOf(fixture, slugs);

    // reason: imported here, not at the top, so a build without the migration fails THIS test instead of the whole file.
    const { DoneContractMigrationService, NO_DECISIONS } = await import("../../src/service/done-contract-migration-service");
    const { createRealMigrationGit } = await import("../../src/adapters/real-done-contract-migration-git");
    const dbPath = join(fixture.dir, ".lore", "lore.db");
    registerRunInDb(dbPath, LIVE_TEST_RUN);
    const store = actedStore(new SQLiteStore(dbPath));
    try {
      const corpus = new CorpusService(store, new RecordLockService(store, new GateEnforcer(undefined)));
      // The failure: the LAST companion write carries a stale CAS base, so the store transaction fails after the first writes.
      const failing: DocWritePort = new Proxy(corpus, {
        get(target, prop) {
          if (prop !== "writeDoc") return Reflect.get(target, prop, target) as unknown;
          return (request: Parameters<CorpusService["writeDoc"]>[0]) => {
            const companions = request.extras?.also_update ?? [];
            const broken = companions.map((write, index) => (index === companions.length - 1 ? { ...write, opts: { expected_version: (write.opts.expected_version ?? 0) + 50 } } : write));
            return target.writeDoc({ ...request, extras: { ...request.extras, also_update: broken } });
          };
        },
      });
      const service = new DoneContractMigrationService(
        store,
        failing,
        new DoneContractService(store, DONE_CONTRACT_CONFIG, createRealDoneContractGit(fixture.dir)),
        createRealMigrationGit(fixture.dir),
      );
      const result = await service.apply(NO_DECISIONS);
      expect(result.ok).toBe(false);
    } finally {
      store.close();
    }
    expect(await snapshotOf(fixture, slugs)).toEqual(before);
    expect((await fixture.readTask(second)).extra["claim"]).toBeDefined();

    // The same service over the honest writer stores all three, proving the failure above was the injected one.
    const honest = createApp(dbPath, undefined, liveAmbient(), liveWriteContext());
    try {
      const result = await honest.doneContractMigrationService?.apply(NO_DECISIONS);
      expect(result?.ok, JSON.stringify(result)).toBe(true);
    } finally {
      honest.close();
    }
    for (const slug of slugs) expect((await fixture.readTask(slug)).extra["done_contract"], slug).toBeDefined();
  });
});

// ───────────────────────────── AC-DCF-3: landed tasks migrate at their landing, one union run ─────────────────────────────

interface LandedWorld {
  readonly fixture: DoneContractFixture;
  readonly log: string;
  readonly a: string;
  readonly b: string;
  /** The landing commit L (the merge of the branch into main). */
  readonly landing: string;
  /** Main's tip after an unrelated commit followed L. */
  readonly main: string;
}

const gitC = (dir: string, args: readonly string[]): string => execFileSync("git", ["-c", "user.email=f@example.invalid", "-c", "user.name=fixture", ...args], { cwd: dir, encoding: "utf8" }).trim();

/** The oracle commands: each appends one line to a log OUTSIDE the repository; a test file named *fail* fails. */
function logCommandsAt(log: string): { install: string; typecheck: string; test_file: string } {
  return {
    install: `sh -c 'echo install >> ${log}'`,
    typecheck: `sh -c 'echo typecheck >> ${log}; echo typecheck-ok'`,
    test_file: `sh -c 'echo "test $0" >> ${log}; case "$0" in *fail*) echo failing; exit 1;; esac; echo Ran 1 tests in "$0"' {file}`,
  };
}

/**
 * Two approved code tasks without a contract whose one branch landed on main at L, each holding pass rows recorded only on the
 * pre-landing branch commit, then an unrelated commit on main (so main's tip is no longer L). Both anchor tests/shared.test.ts.
 */
async function buildLandedWorld(bTest = "tests/b.test.ts"): Promise<LandedWorld> {
  const scratch = mkdtempSync(join(tmpdir(), "dcf3-"));
  scratches.push(scratch);
  const log = join(scratch, "runs.log");
  writeFileSync(log, "");
  const fixture = await makeDoneContractFixture();
  fixtures.push(fixture);
  fixture.setDoneContractConfig(logCommandsAt(log));
  patchLoreConfig(fixture.dir, { workflow: { gates: { "plan-close": { enabled: false }, "plan-promote": { enabled: false } }, integrate: { floor_command: "true" } } });
  const plan = await fixture.createPlan("Landed plan");
  const base = fixture.git(["rev-parse", "HEAD"]);
  gitC(fixture.dir, ["checkout", "-q", "-b", "feat-landed"]);
  mkdirSync(join(fixture.dir, "tests"), { recursive: true });
  for (const file of ["tests/shared.test.ts", "tests/a.test.ts", bTest]) writeFileSync(join(fixture.dir, file), `// ${file}\n`);
  gitC(fixture.dir, ["add", "-A"]);
  gitC(fixture.dir, ["commit", "-q", "-m", "work"]);
  const branchHead = fixture.git(["rev-parse", "HEAD"]);
  gitC(fixture.dir, ["checkout", "-q", "main"]);
  gitC(fixture.dir, ["merge", "-q", "--no-ff", "-m", "merge(feat-landed)", "feat-landed"]);
  const landing = fixture.git(["rev-parse", "HEAD"]);
  writeFileSync(join(fixture.dir, "unrelated.txt"), "later work on main\n");
  gitC(fixture.dir, ["add", "-A"]);
  gitC(fixture.dir, ["commit", "-q", "-m", "unrelated commit after the landing"]);
  const main = fixture.git(["rev-parse", "HEAD"]);

  const landingRecord = { branch: "feat-landed", branch_head: branchHead, main_before: base, main_after: landing, landing_commit: landing, recorded_at: NOW, kind: "commits", start_head: base, tip: branchHead, integration_head: landing, measured_at: NOW };
  const preLandingPass = (file: string): Record<string, unknown> => ({
    oracle: "test",
    command: logCommandsAt(log).test_file.replace("{file}", file),
    result: "pass",
    recorded_at: NOW,
    recorded_by: "agent:legacy",
    capture_source: "runner",
    attestation: { runner: "lore-cli", exit_code: 0, duration_ms: 5, timed_out: false, head_sha: branchHead },
  });
  const seed = (title: string, files: readonly string[]): Promise<string> =>
    seedLegacyTask(fixture, plan, {
      title,
      anchors: files,
      landing: landingRecord,
      claimAudit: { branch: "feat-landed", worktree: "/nonexistent/landed-wt", base_sha: base },
      evidence: [evidenceRow("expected-fail", true), ...files.map(preLandingPass)],
    });
  const a = await seed("Landed A", ["tests/shared.test.ts", "tests/a.test.ts"]);
  const b = await seed("Landed B", ["tests/shared.test.ts", bTest]);
  return { fixture, log, a, b, landing, main };
}

const runLines = (world: LandedWorld): string[] => readFileSync(world.log, "utf8").split("\n").filter((line) => line !== "");
const countRuns = (world: LandedWorld, line: string): number => runLines(world).filter((candidate) => candidate === line).length;

interface StoredContract {
  readonly compiled_at_commit: string;
  readonly oracles: readonly { id: string }[];
}

interface Evidence {
  readonly command: string;
  readonly result: string;
  readonly recorded_by: string;
  readonly attestation?: { head_sha?: string; recorded_at_landing?: string };
}

const evidenceOf = async (world: LandedWorld, slug: string): Promise<Evidence[]> => ((await world.fixture.readTask(slug)).extra["verification_evidence"] ?? []) as Evidence[];

describe("AC-DCF-3: landed tasks migrate at their landing and are attested by one union run on main", () => {
  it("AC-DCF-3: compiles both contracts at L, runs the union once on main's tip, records integrate rows of that landing on both tasks, and done archives each with no further run", async () => {
    const world = await buildLandedWorld();
    const { fixture, a, b, landing, main } = world;

    // The preview writes nothing and runs no oracle.
    const preview = await fixture.run(["migrate", "done-contract"]);
    expect(preview.exitCode, preview.stderr + preview.stdout).toBe(0);
    expect(runLines(world)).toEqual([]);

    const applied = await fixture.run(["migrate", "done-contract", "--apply"]);
    expect(applied.exitCode, applied.stderr + applied.stdout).toBe(0);

    for (const slug of [a, b]) {
      const task = await fixture.readTask(slug);
      const contract = task.extra["done_contract"] as StoredContract;
      // The #615 state: compiling at the migration commit leaves every earlier row stale; the contract is compiled at L instead.
      expect(contract.compiled_at_commit, slug).toBe(landing);
      expect(task.status, slug).toBe("approved");
    }
    // One run per distinct oracle, counted from the runner log: the shared test file ran once for two tasks, the install once.
    expect(countRuns(world, "test tests/shared.test.ts")).toBe(1);
    expect(countRuns(world, "test tests/a.test.ts")).toBe(1);
    expect(countRuns(world, "test tests/b.test.ts")).toBe(1);
    expect(countRuns(world, "typecheck")).toBe(1);
    expect(countRuns(world, "install")).toBe(1);

    // Rows: integrate rows of landing L, bound to the tree of main's newest commit (not L), on both tasks.
    for (const slug of [a, b]) {
      const fresh = (await evidenceOf(world, slug)).filter((row) => row.attestation?.recorded_at_landing === landing);
      expect(fresh.length, slug).toBe(3);
      expect(fresh.every((row) => row.result === "pass" && row.attestation?.head_sha === main), slug).toBe(true);
    }

    // done of each exits 0 and runs nothing more.
    const runsBefore = runLines(world).length;
    for (const slug of [a, b]) {
      const done = await fixture.run(["done", slug]);
      expect(done.exitCode, `${slug}: ${done.stderr}${done.stdout}`).toBe(0);
      expect((await fixture.readTask(slug)).status).toBe("archived");
    }
    expect(runLines(world).length).toBe(runsBefore);
  });

  it("AC-DCF-3: two migrations started together run the union once; the other waits its turn, runs no oracle and exits 0", async () => {
    const world = await buildLandedWorld();
    const results = await Promise.all([world.fixture.run(["migrate", "done-contract", "--apply"]), world.fixture.run(["migrate", "done-contract", "--apply"])]);
    for (const result of results) expect(result.exitCode, result.stderr + result.stdout).toBe(0);
    expect(countRuns(world, "test tests/shared.test.ts")).toBe(1);
    expect(countRuns(world, "typecheck")).toBe(1);
    expect(countRuns(world, "install")).toBe(1);
    for (const slug of [world.a, world.b]) expect((await evidenceOf(world, slug)).filter((row) => row.attestation?.recorded_at_landing === world.landing).length, slug).toBe(3);
    // A later run finds nothing to attest.
    const again = await world.fixture.run(["migrate", "done-contract", "--apply"]);
    expect(again.exitCode, again.stderr + again.stdout).toBe(0);
    expect(countRuns(world, "install")).toBe(1);
  });

  it("AC-DCF-3: a failing oracle leaves its task unarchived and the migration exits 4 naming the task and oracle; the other task is stored and doneable", async () => {
    const world = await buildLandedWorld("tests/b-fail.test.ts");
    const { fixture, a, b } = world;
    const applied = await fixture.run(["migrate", "done-contract", "--apply"]);
    expect(applied.exitCode, applied.stderr + applied.stdout).toBe(4);
    const text = `${applied.stdout}\n${applied.stderr}`;
    expect(text).toContain(b);
    expect(text).toContain("test:tests/b-fail.test.ts");

    expect((await fixture.readTask(a)).extra["done_contract"]).toBeDefined();
    expect((await fixture.readTask(b)).extra["done_contract"]).toBeDefined();
    expect((await evidenceOf(world, b)).filter((row) => row.attestation?.recorded_at_landing === world.landing)).toEqual([]);

    const doneA = await fixture.run(["done", a]);
    expect(doneA.exitCode, doneA.stderr + doneA.stdout).toBe(0);
    const doneB = await fixture.run(["done", b]);
    expect(doneB.exitCode, doneB.stderr).toBe(4);
    expect((await fixture.readTask(b)).status).not.toBe("archived");
  });
});
