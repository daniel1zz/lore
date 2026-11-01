// @spawns-external git the fixture builds and reads a throwaway git repository
/**
 * Test helper: the throwaway project every done-contract test (spec-done-contract-compiled-at-approve-task-kinds-write-sets,
 * AC-DCS1-*) builds on.
 *
 * Purpose: one place that makes a git repository with a clean tree, a `lore init` corpus inside it, a requirements document,
 * a spec holding script, ai and human criteria, plans with and without an integration branch, tasks of each kind, and the three
 * `workflow.done_contract.*` config keys, so a test states only what it is about.
 *
 * Public surface: {@link makeDoneContractFixture}, {@link DoneContractFixture}, {@link DONE_CONTRACT_CONFIG},
 *   {@link seedApprovedTaskWithoutContract}.
 *
 * Invariants:
 *   - the corpus is `mkdtemp` + `lore init` under the OS temp dir and the HOME of every run is {@link FIXTURE_HOME_OUTSIDE_REPO};
 *     the repository's own `.lore/` is never touched;
 *   - every `lore` call is a failing exit unless the test asked for it through `run` (`mustRun` throws on a non-zero exit);
 *   - `seedApprovedTaskWithoutContract` is a HELPER, not a test file: it writes an approved task with no contract in-process
 *     (no approval port), only for the migration's fixtures of AC-DCS1-22 and AC-DCS1-23 (a task approved before the change).
 *
 * Side-effect class: IO (temp directories, `git`, in-process `lore`).
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isTestFileAnchor, type TaskKind } from "@lore/core";
import { createApp } from "../../src/app";
import { liveAmbient, liveWriteContext } from "../live-invocation";
import { FIXTURE_HOME_OUTSIDE_REPO, makeCleanTreeRepo } from "./clean-tree-repo";
import { patchLoreConfig } from "./patch-lore-config";
import { runLoreInProcess } from "./run-lore-in-process";

/** The three commands of this repository's own `.lore/config.yaml` (AC-DCS1-9); the fixture seeds the same ones. */
export const DONE_CONTRACT_CONFIG = {
  install: "bun install --frozen-lockfile",
  typecheck: "bun run typecheck",
  test_file: "bun run test:file {file}",
} as const;

/** What one `lore` call produced. */
export interface FixtureRun {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/** A task as the tests read it back. */
export interface FixtureTask {
  readonly id: string;
  readonly slug: string;
  readonly status: string;
  readonly version: number;
  readonly extra: Record<string, unknown>;
}

/** Options of {@link DoneContractFixture.createTask}. */
export interface CreateTaskOptions {
  readonly plan: string;
  readonly kind: TaskKind;
  readonly title?: string;
  /** `--anchor` entries (repo-relative paths). */
  readonly anchors?: readonly string[];
  /** `true`: every anchor is passed as `--anchor`, even an absent test file (the AC-DCF-1 refusal); default: an absent test file is `--creates`. */
  readonly plainAnchors?: boolean;
  /** `--ac-scope` ids; default: every criterion the spec declares as a script AC is NOT claimed (an explicit empty scope). */
  readonly acScope?: readonly string[];
}

/** One throwaway project; see the module header. */
export interface DoneContractFixture {
  /** The repository (and corpus) root. */
  readonly dir: string;
  /** Slug of the spec the plans are parented to. */
  readonly spec: string;
  /** Runs `lore <args>` in-process in the fixture and returns what it produced. */
  run(args: readonly string[]): Promise<FixtureRun>;
  /** Like {@link run} but throws unless the exit code is 0; returns stdout. */
  mustRun(args: readonly string[]): Promise<string>;
  /** Runs `git <args>` in the fixture and returns trimmed stdout. */
  git(args: readonly string[]): string;
  /** Creates a plan under the fixture spec; with `integrationBranch` declares it (the branch is NOT created). */
  createPlan(title: string, integrationBranch?: string): Promise<string>;
  /** Creates a draft task of the given kind; returns its slug. */
  createTask(options: CreateTaskOptions): Promise<string>;
  /** Reads a task back through `lore get --json`. */
  readTask(slug: string): Promise<FixtureTask>;
  /** Replaces or removes the three `workflow.done_contract.*` keys in the fixture's config. */
  setDoneContractConfig(config: Partial<Record<"install" | "typecheck" | "test_file", string>>): void;
  /** Removes the fixture directory. */
  dispose(): void;
}

function slugOf(stdout: string, what: string): string {
  const slug = stdout.match(/Slug:\s+(\S+)/)?.[1];
  if (slug === undefined) throw new Error(`could not read the slug of ${what} from: ${stdout}`);
  return slug;
}

/** Options of {@link makeDoneContractFixture}. */
export interface MakeFixtureOptions {
  /**
   * `false` leaves the three `workflow.done_contract.*` keys out of the config (default: they are seeded). A test whose subject
   * is NOT the contract uses it so that its setup never depends on the config schema that the test is about.
   */
  readonly seedDoneContractConfig?: boolean;
}

/**
 * Builds the fixture: a clean git repository, `lore init`, a requirements document, a spec and the three config keys.
 *
 * @returns the fixture; call `dispose()` in `afterAll`.
 */
export async function makeDoneContractFixture(options: MakeFixtureOptions = {}): Promise<DoneContractFixture> {
  const dir = mkdtempSync(join(tmpdir(), "lore-done-contract-"));
  mkdirSync(FIXTURE_HOME_OUTSIDE_REPO, { recursive: true });
  makeCleanTreeRepo(dir);

  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (typeof value === "string") env[key] = value;
  const runEnv = { ...env, HOME: FIXTURE_HOME_OUTSIDE_REPO };

  const run = async (args: readonly string[]): Promise<FixtureRun> => {
    const result = await runLoreInProcess([...args], { cwd: dir, home: FIXTURE_HOME_OUTSIDE_REPO, env: runEnv });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
  };
  const mustRun = async (args: readonly string[]): Promise<string> => {
    const result = await run(args);
    if (result.exitCode !== 0) throw new Error(`lore ${args.join(" ")} exited ${result.exitCode}: ${result.stderr}${result.stdout}`);
    return result.stdout;
  };
  const git = (args: readonly string[]): string => execFileSync("git", [...args], { cwd: dir, encoding: "utf8" }).trim();

  await mustRun(["init"]);
  // reason: a spec/adr approval needs a review judgment by default; the fixture's specs are fixture steps, not the subject.
  patchLoreConfig(dir, {
    workflow: {
      review: { judgment_required_types: [] },
      ...(options.seedDoneContractConfig === false ? {} : { done_contract: { ...DONE_CONTRACT_CONFIG } }),
    },
  });

  await mustRun(["create", "prd", "--title", "Fixture PRD", "--content", "Root requirements.", "--no-ai"]);
  // reason: a spec takes no parent (it belongs to the product trees through its criteria's citations).
  const spec = slugOf(
    await mustRun(["create", "spec", "--title", "Fixture Spec", "--kind", "tech", "--content", "## Overview\n\nBody.\n", "--no-ai"]),
    "the spec",
  );
  await mustRun(["ac", "add", spec, "AC-FX-1", "--statement", "A script criterion.", "--mode", "script", "--oracle", "test", "--command", "echo fx1"]);
  await mustRun(["ac", "add", spec, "AC-FX-AI", "--statement", "An AI-judged criterion.", "--mode", "ai", "--rubric", "Judge it."]);
  await mustRun(["ac", "add", spec, "AC-FX-HUMAN", "--statement", "A human-judged criterion.", "--mode", "human", "--note", "A person checks."]);

  return {
    dir,
    spec,
    run,
    mustRun,
    git,
    async createPlan(title, integrationBranch) {
      const plan = slugOf(await mustRun(["create", "plan", "--title", title, "--parent", spec, "--content", "## Plan\n\nBody.\n", "--no-ai"]), title);
      if (integrationBranch !== undefined) await mustRun(["plan", "integration-branch", plan, integrationBranch]);
      return plan;
    },
    async createTask(options) {
      const args = [
        "create", "task", "--title", options.title ?? `Fixture ${options.kind} task`, "--plan-id", options.plan, "--kind", options.kind,
        "--content", "## Task\n\nBody.\n", "--no-ai",
      ];
      for (const anchor of options.anchors ?? []) {
        // reason: BR-1547 — approve refuses a test file that is anchored, absent at the base tip and not declared `--creates`; a
        // fixture task whose test file does not exist yet declares it, as its author would. `plainAnchors` keeps the refusal reachable.
        const absentTest = options.plainAnchors !== true && isTestFileAnchor(anchor) && !existsSync(join(dir, anchor));
        args.push(absentTest ? "--creates" : "--anchor", anchor);
      }
      const scope = options.acScope ?? [];
      if (scope.length === 0) args.push("--ac-scope", "");
      for (const id of scope) args.push("--ac-scope", id);
      return slugOf(await mustRun(args), "the task");
    },
    async readTask(slug) {
      const parsed = JSON.parse(await mustRun(["get", slug, "--json"])) as { data: { doc?: FixtureTask } & FixtureTask };
      const doc = parsed.data.doc ?? parsed.data;
      return { id: doc.id, slug: doc.slug, status: doc.status, version: doc.version, extra: doc.extra };
    },
    setDoneContractConfig(config) {
      patchLoreConfig(dir, { workflow: { done_contract: { ...config } } });
    },
    dispose() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/**
 * Writes an APPROVED task with no `done_contract` straight into the fixture's corpus, in-process and with no approval port:
 * the shape of a task approved before the contract existed (AC-DCS1-22, AC-DCS1-23).
 *
 * @param fixture - the fixture whose corpus receives the task
 * @param planSlug - the plan the task belongs to
 * @param title - the task title
 * @returns the task's slug
 * @throws Error when a service call fails (a fixture fault, never silent)
 */
export async function seedApprovedTaskWithoutContract(fixture: DoneContractFixture, planSlug: string, title: string): Promise<string> {
  const app = createApp(join(fixture.dir, ".lore", "lore.db"), undefined, liveAmbient(), liveWriteContext());
  try {
    const plan = await app.corpusService.get(planSlug);
    if (!plan.ok) throw new Error(`seed: plan ${planSlug} not found: ${JSON.stringify(plan.error)}`);
    const created = await app.corpusService.create({
      type: "task",
      title,
      content: "## Task\n\nApproved before the contract existed.\n",
      parent_id: plan.value.doc.id,
      extra: { plan_id: plan.value.doc.id, ac_scope: [] },
    });
    if (!created.ok) throw new Error(`seed: create failed: ${JSON.stringify(created.error)}`);
    const approved = await app.reviewService.approve(created.value.id);
    if (!approved.ok) throw new Error(`seed: approve failed: ${JSON.stringify(approved.error)}`);
    return created.value.slug;
  } finally {
    app.close();
  }
}
