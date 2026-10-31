// @spawns-external git throwaway fixture repositories: the real selector and history readers run git against them
/**
 * @spec_ref spec-a-plan-s-close-runs-only-the-tests-its-changes-can-reach (AC-SC-3, AC-SC-4, BR-1496, BR-1497)
 *
 * A plan's close runs only the selector's tests for its changed paths, at the commit holding its last landing, and never the
 * full suite. A throwaway git repository carries the plan's landings; the REAL selector (`createGitTestSelection` over
 * `scripts/changed-tests.ts`), the real history / file-existence / containment readers, the real `regressionAtHead` and the real
 * `SuiteResultService` over the in-memory store; only the test processes are a counting fake (a test file is red at a commit when
 * its source contains "BROKEN" or is gone), and that fake also carries a `runSuite` spy that must never be called.
 *
 * Dimensions: HAPPY (selection at L, union of the landings' paths), NEGATIVE (an unselected red file is never run or charged; a
 * file added after L is not selected), BOUNDARY (empty selection, orphan source, deleted path, removed test, unresolved alias),
 * ERROR (an unparseable test file or an unreadable selection is not measured, never pass), STATE (a second assess reuses the
 * stored results at L), REGRESSION (every "false green guarded" clause of AC-SC-3 and AC-SC-4).
 */

import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ok, type MilestoneFacts } from "@lore/core";
import { createGitTestSelection } from "../../src/adapters/cli/assess-selection.js";
import { createGitFileExistsAt, createGitFirstParentCommitContaining, createGitFirstParentHistory } from "../../src/adapters/cli/assess-regression-git.js";
import { InMemoryStore } from "../../src/store/in-memory-store.js";
import { factsDimensions } from "../../src/service/milestone-review-judgment.js";
import { regressionAtHead, type RegressionAtHead, type RegressionAtHeadPorts, type RegressionLandingInput, type TestSelectionPort } from "../../src/service/regression-at-head.js";
import { SuiteResultService, type CommitSuiteRunnerPort, type FileRunOutcome, type RunBatchOptions } from "../../src/service/suite-result-service.js";

const A_TEST = "packages/x/tests/a.test.ts";
const B_TEST = "packages/x/tests/b.test.ts";
const C_TEST = "packages/x/tests/c.test.ts";
const LATE_TEST = "packages/x/tests/late.test.ts";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const git = (cwd: string, args: readonly string[]): string =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t.invalid", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/** A throwaway repository on `main`; `commit` writes (string) or deletes (null) files and returns the new commit. */
function createRepo(): { cwd: string; commit: (files: Readonly<Record<string, string | null>>, message: string) => string } {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "selected-at-close-")));
  dirs.push(cwd);
  git(cwd, ["init", "-q", "-b", "main"]);
  return {
    cwd,
    commit: (files, message) => {
      for (const [path, content] of Object.entries(files)) {
        const absolute = join(cwd, path);
        if (content === null) rmSync(absolute, { force: true });
        else {
          mkdirSync(dirname(absolute), { recursive: true });
          writeFileSync(absolute, content);
        }
      }
      git(cwd, ["add", "-A"]);
      git(cwd, ["commit", "-q", "--allow-empty", "-m", message]);
      return git(cwd, ["rev-parse", "HEAD"]);
    },
  };
}

const GOOD = (name: string): string => `export const ${name} = 1;\n`;
const BROKEN = (name: string): string => `export const ${name} = "BROKEN";\n`;
const testImporting = (name: string, header = ""): string => `${header}import "../src/${name}.js";\n`;

/** The base tree: three source files with one test each, an orphan source, docs and a tsconfig. `c` is red from the start. */
const BASE: Readonly<Record<string, string>> = {
  "packages/x/tsconfig.json": "{}\n",
  "packages/x/src/a.ts": GOOD("a"),
  "packages/x/src/b.ts": GOOD("b"),
  "packages/x/src/c.ts": BROKEN("c"),
  "packages/x/src/orphan.ts": GOOD("orphan"),
  "packages/x/tests/a.test.ts": testImporting("a"),
  "packages/x/tests/b.test.ts": testImporting("b"),
  "packages/x/tests/c.test.ts": testImporting("c"),
  "docs/readme.md": "docs\n",
};

interface Invocation {
  readonly kind: "together" | "alone";
  readonly commit: string;
  readonly files: readonly string[];
  readonly options: RunBatchOptions | undefined;
}

interface World {
  readonly cwd: string;
  readonly store: InMemoryStore;
  readonly service: SuiteResultService;
  readonly invocations: Invocation[];
  /** How often a full-suite verb was called on the runner: the port has none, so a call could only come from a stray `runSuite`. */
  readonly suiteCalls: () => number;
  readonly ports: (selectTests?: TestSelectionPort) => RegressionAtHeadPorts;
}

/** A test file is red at a commit when its source (`tests/n.test.ts` -> `src/n.ts`) contains BROKEN or is gone. */
function isRedAt(cwd: string, commit: string, file: string): boolean {
  const match = /^packages\/x\/tests\/([a-z]+)\.test\.ts$/.exec(file);
  if (match === null) return false;
  try {
    return git(cwd, ["show", `${commit}:packages/x/src/${match[1]!}.ts`]).includes("BROKEN");
  } catch {
    return true;
  }
}

function newWorld(cwd: string): World {
  const store = new InMemoryStore();
  let n = 0;
  const service = new SuiteResultService({ store, now: () => `2026-10-31T10:00:00.${String(++n).padStart(3, "0")}Z`, newId: () => `suite-sc-${String(++n)}`, clockMs: () => n * 10 });
  const invocations: Invocation[] = [];
  let suiteCalls = 0;
  const outcomes = (commit: string, files: readonly string[]): readonly FileRunOutcome[] =>
    files.map((file) => ({ file, exit_code: isRedAt(cwd, commit, file) ? 1 : 0, output_tail: "", duration_ms: 1 }));
  const runner: CommitSuiteRunnerPort = {
    resolveCommit: async (ref) => ok({ commit: git(cwd, ["rev-parse", ref]), tree: git(cwd, ["rev-parse", `${ref}^{tree}`]) }),
    runFiles: async (commit, files) => {
      invocations.push({ kind: "alone", commit, files: [...files], options: undefined });
      return ok(outcomes(commit, files));
    },
    runFilesTogether: async (commit, files, options) => {
      invocations.push({ kind: "together", commit, files: [...files], options });
      return ok(outcomes(commit, files));
    },
  };
  // reason: the port has no full-suite verb; a `runSuite` that a regression of the old shape would call is planted and counted.
  Object.assign(runner, {
    runSuite: async () => {
      suiteCalls += 1;
      throw new Error("the full suite must never run at a close");
    },
  });
  return {
    cwd,
    store,
    service,
    invocations,
    suiteCalls: () => suiteCalls,
    ports: (selectTests = createGitTestSelection(cwd, process.env)) => ({
      suites: service,
      runner,
      selectTests,
      headRef: "main",
      firstParentHistory: createGitFirstParentHistory(cwd, process.env),
      fileExistsAt: createGitFileExistsAt(cwd, process.env),
      firstParentCommitContaining: createGitFirstParentCommitContaining(cwd, process.env),
    }),
  };
}

const landingOf = (cwd: string, commit: string): RegressionLandingInput => ({ landing_commit: commit, main_before: git(cwd, ["rev-parse", `${commit}^1`]), task_slugs: [`task-${commit.slice(0, 7)}`] });

async function assess(world: World, landings: readonly RegressionLandingInput[], selectTests?: TestSelectionPort): Promise<RegressionAtHead> {
  const result = await regressionAtHead(landings, [], world.ports(selectTests));
  if (!result.ok) throw new Error(`regressionAtHead failed: ${result.error.code}`);
  return result.value;
}

const dimensionOf = (rows: NonNullable<MilestoneFacts["regression"]>) => factsDimensions({ regression: rows }, []).regression;
const selectionRowOf = (r: RegressionAtHead) => r.rows.find((row) => row.subject.startsWith("selection@") || row.subject === "selection");
const filesRun = (world: World): string[] => [...new Set(world.invocations.flatMap((i) => i.files))].sort();

/**
 * The plan of AC-SC-3: L1 breaks `a`, L2 touches `b`; then docs, then a NEW test (`late`) that imports `a` lands after L.
 * `c` is red from the start but no landing touches it.
 */
function planRepo(headerOfB = ""): { repo: ReturnType<typeof createRepo>; l1: string; l2: string; head: string } {
  const repo = createRepo();
  repo.commit({ ...BASE, "packages/x/tests/b.test.ts": testImporting("b", headerOfB) }, "base");
  const l1 = repo.commit({ "packages/x/src/a.ts": BROKEN("a") }, "L1: break a");
  const l2 = repo.commit({ "packages/x/src/b.ts": GOOD("b2") }, "L2: touch b");
  repo.commit({ "docs/readme.md": "docs v2\n" }, "docs after L");
  const head = repo.commit({ [LATE_TEST]: testImporting("a") }, "a new test lands after L");
  return { repo, l1, l2, head };
}

describe("close runs the selection at the commit of the last landing", () => {
  it("AC-SC-3 the union of both landings' paths selects a and b at L2, runs them in one batch there, never the full suite, never c (red but unselected), never late (added after L)", async () => {
    const { repo, l1, l2, head } = planRepo();
    const world = newWorld(repo.cwd);
    const r = await assess(world, [landingOf(repo.cwd, l1), landingOf(repo.cwd, l2)]);
    // the first invocation is the whole selection, together, at L = L2
    expect(world.invocations[0]).toMatchObject({ kind: "together", commit: l2, files: [A_TEST, B_TEST] });
    // false green guarded: selecting at head would add the test that landed after L, and c is red at L but not selected
    expect(filesRun(world)).toEqual([A_TEST, B_TEST]);
    expect(filesRun(world)).not.toContain(C_TEST);
    expect(filesRun(world)).not.toContain(LATE_TEST);
    expect(world.suiteCalls()).toBe(0);
    // a is red at L and still red alone at head: attributed exactly as before, to L1
    expect(r.charged).toEqual([{ file: A_TEST, landing: l1 }]);
    expect(dimensionOf(r.rows).verdict).toBe("fail");
    // nothing but the selection ran before the head recheck: every other batch is at head or a probed commit, never a full set
    expect(world.invocations.filter((i) => i.kind === "together" && i.commit === head)).toEqual([{ kind: "together", commit: head, files: [A_TEST], options: {} }]);
    // control: the same landings selected at head WOULD name the late test, so selecting at L is what keeps it out
    const atHead = await createGitTestSelection(repo.cwd, process.env)({ commit: head, landingCommits: [l1, l2] });
    expect(atHead.ok && atHead.value.selected.map((f) => f.path)).toEqual([A_TEST, B_TEST, LATE_TEST]);
  });

  it("AC-SC-3 the review output states the selected count, the total and that the selector accounting is stored", async () => {
    const { repo, l1, l2 } = planRepo();
    const world = newWorld(repo.cwd);
    const r = await assess(world, [landingOf(repo.cwd, l1), landingOf(repo.cwd, l2)]);
    const row = selectionRowOf(r);
    expect(row?.detail).toContain("regression measured on 2 selected test files of 3 (selector accounting stored)");
    expect(row?.detail).toContain(`commit: ${l2}`);
    expect(row?.detail).toContain("selected total: 2");
    expect(r.selection).toEqual({ commit: l2, selected: 2, total: 3 });
    expect(dimensionOf(r.rows).reason).toContain("regression measured on 2 selected test files of 3 (selector accounting stored)");
  });

  it("AC-SC-3 a second assess of the same plan reuses the stored results at L and invokes no runner for them", async () => {
    const { repo, l1, l2 } = planRepo();
    const world = newWorld(repo.cwd);
    const landings = [landingOf(repo.cwd, l1), landingOf(repo.cwd, l2)];
    const first = await assess(world, landings);
    const invoked = world.invocations.length;
    expect(invoked).toBeGreaterThan(0);
    const second = await assess(world, landings);
    expect(world.invocations.length).toBe(invoked);
    expect(second.charged).toEqual(first.charged);
    expect(world.suiteCalls()).toBe(0);
  });

  it.each([
    ["a stored suite exists at head", "stored"],
    ["no suite exists", "none"],
    ["a suite is in flight at head", "in-flight"],
  ] as const)("AC-SC-3 the full-suite runner is invoked zero times when %s, and the verdict is the same", async (_label, path) => {
    const { repo, l1, l2, head } = planRepo();
    const world = newWorld(repo.cwd);
    if (path === "stored") {
      const stored = await world.store.insertSuiteResult({
        id: "stored-suite-at-head",
        commit_sha: head,
        tree_sha: git(repo.cwd, ["rev-parse", `${head}^{tree}`]),
        status: "measured",
        attempt: 1,
        cause: null,
        commands: [{ command: "bun run test", exit_code: 1, output_tail: "" }],
        skipped: [],
        failing_test_files: [{ file: C_TEST, imports: [] }],
        duration_ms: 1,
        measured_at: "2026-10-31T09:00:00.000Z",
      });
      expect(stored.ok).toBe(true);
    }
    if (path === "in-flight") {
      // a `suite:<head>` lease held by another review, live: the old join-in-flight would wait for it
      const held = await world.store.acquireLease(`suite:${head}`, "another-review", "2026-10-31T10:00:00.000Z", "2999-01-01T00:00:00.000Z");
      expect(held.ok).toBe(true);
    }
    const r = await assess(world, [landingOf(repo.cwd, l1), landingOf(repo.cwd, l2)]);
    expect(world.suiteCalls()).toBe(0);
    expect(filesRun(world)).toEqual([A_TEST, B_TEST]);
    expect(r.charged).toEqual([{ file: A_TEST, landing: l1 }]);
    // the stored suite's red file (c) is neither read nor charged: only the selection decides
    expect(r.files.map((f) => f.file)).toEqual([A_TEST]);
  });

  it("AC-SC-3 a selection holding a declared-spawn test builds first, one that holds none does not", async () => {
    const withSpawn = planRepo("// @spawns dist/lore\n");
    const builds = newWorld(withSpawn.repo.cwd);
    await assess(builds, [landingOf(withSpawn.repo.cwd, withSpawn.l1), landingOf(withSpawn.repo.cwd, withSpawn.l2)]);
    expect(builds.invocations[0]?.options).toEqual({ buildFirst: true });

    const without = planRepo();
    const plain = newWorld(without.repo.cwd);
    await assess(plain, [landingOf(without.repo.cwd, without.l1), landingOf(without.repo.cwd, without.l2)]);
    expect(plain.invocations[0]?.options).toEqual({ buildFirst: false });
  });

  it("AC-SC-3 a selected file red at L and green at head is not charged, and the plan's unrelated red file stays out", async () => {
    const repo = createRepo();
    repo.commit(BASE, "base");
    const l1 = repo.commit({ "packages/x/src/a.ts": BROKEN("a") }, "L1: break a");
    repo.commit({ "packages/x/src/a.ts": GOOD("a") }, "a fixed after L");
    const world = newWorld(repo.cwd);
    const r = await assess(world, [landingOf(repo.cwd, l1)]);
    expect(r.charged).toEqual([]);
    expect(r.files).toEqual([{ file: A_TEST, outcome: "green-at-head", commit: git(repo.cwd, ["rev-parse", "main"]) }]);
    expect(dimensionOf(r.rows).verdict).toBe("pass");
  });
});

describe("selection accounting", () => {
  it("AC-SC-4 a test file at L the selector cannot parse is named and makes regression not measured, never pass; nothing runs", async () => {
    const repo = createRepo();
    repo.commit(BASE, "base");
    repo.commit({ "packages/x/tests/bad.test.ts": '// @reads /etc/passwd\nimport "../src/a.js";\n' }, "a test with a malformed declaration");
    const l1 = repo.commit({ "packages/x/src/a.ts": GOOD("a2") }, "L1: touch a");
    const world = newWorld(repo.cwd);
    const r = await assess(world, [landingOf(repo.cwd, l1)]);
    expect(r.rows[0]).toMatchObject({ verdict: "not-measured" });
    expect(r.rows[0]?.detail).toContain("packages/x/tests/bad.test.ts");
    expect(dimensionOf(r.rows).verdict).toBe("not-measured");
    expect(dimensionOf(r.rows).reason).toContain("packages/x/tests/bad.test.ts");
    // false green guarded: dropping the unparseable file silently would run a and pass
    expect(world.invocations).toEqual([]);
  });

  it("AC-SC-4 a selection git cannot read is not measured, never pass", async () => {
    const repo = createRepo();
    repo.commit(BASE, "base");
    const l1 = repo.commit({ "packages/x/src/a.ts": GOOD("a2") }, "L1: touch a");
    const world = newWorld(repo.cwd);
    const real = createGitTestSelection(repo.cwd, process.env);
    // a landing the repository does not hold: its changed paths cannot be read
    const unreadable: TestSelectionPort = (input) => real({ ...input, landingCommits: [...input.landingCommits, "0".repeat(40)] });
    const r = await assess(world, [landingOf(repo.cwd, l1)], unreadable);
    expect(r.rows[0]).toMatchObject({ verdict: "not-measured" });
    expect(dimensionOf(r.rows).verdict).toBe("not-measured");
    expect(world.invocations).toEqual([]);
  });

  it("AC-SC-4 a path a landing deleted selects the test that imported it at the landing's parent and is never reported unreadable", async () => {
    const repo = createRepo();
    repo.commit(BASE, "base");
    const l1 = repo.commit({ "packages/x/src/b.ts": null }, "L1: delete b (its test stays and now fails)");
    const world = newWorld(repo.cwd);
    const r = await assess(world, [landingOf(repo.cwd, l1)]);
    expect(filesRun(world)).toEqual([B_TEST]);
    const row = selectionRowOf(r);
    expect(row?.verdict).toBe("pass");
    expect(row?.detail).toContain("changed paths in no tree: 0");
    // false green guarded: selecting nothing for a deleted imported file would report na; the test that lost its import is charged
    expect(r.charged).toEqual([{ file: B_TEST, landing: l1 }]);
    expect(r.rows.some((x) => x.verdict === "not-measured")).toBe(false);
  });

  it("AC-SC-4 a test selected through a parent tree but absent at L is named as removed by the plan, not run, and does not make regression not measured", async () => {
    const repo = createRepo();
    repo.commit(BASE, "base");
    const l1 = repo.commit({ "packages/x/src/b.ts": null, "packages/x/tests/b.test.ts": null, "packages/x/src/a.ts": GOOD("a2") }, "L1: the plan removes b and its test, and touches a");
    const world = newWorld(repo.cwd);
    const r = await assess(world, [landingOf(repo.cwd, l1)]);
    const row = selectionRowOf(r);
    expect(row?.verdict).toBe("pass");
    expect(row?.detail).toContain("removed by the changes (selected via a parent tree, absent at the commit): 1");
    expect(row?.detail).toContain(`  ${B_TEST}`);
    expect(filesRun(world)).toEqual([A_TEST]);
    // false green guarded: a removed test turned into not-measured fails here
    expect(r.rows.some((x) => x.verdict === "not-measured")).toBe(false);
    expect(dimensionOf(r.rows).verdict).toBe("pass");
  });

  it("AC-SC-4 an alias import that resolves to nothing is named in the accounting and does not change the verdict", async () => {
    const repo = createRepo();
    repo.commit(
      {
        ...BASE,
        "packages/dash/tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }),
        "packages/dash/src/ok.ts": GOOD("ok"),
        "packages/dash/tests/z.test.tsx": 'import "@/ok";\n',
      },
      "base",
    );
    const l1 = repo.commit({ "packages/dash/tests/z.test.tsx": 'import "@/ok";\nimport "@/gone";\n' }, "L1: the dashboard test imports a file that does not exist");
    const world = newWorld(repo.cwd);
    const r = await assess(world, [landingOf(repo.cwd, l1)]);
    const row = selectionRowOf(r);
    expect(row?.detail).toContain("alias imports resolving to no file: 1");
    expect(row?.detail).toContain("@/gone");
    expect(row?.verdict).toBe("pass");
    expect(dimensionOf(r.rows).verdict).toBe("pass");
    expect(filesRun(world)).toEqual(["packages/dash/tests/z.test.tsx"]);
  });

  it("AC-SC-4 a plan whose selection is empty (only docs, or a source no test reaches) is na with the reason no test reaches this plan's changes, never pass", async () => {
    const docsOnly = createRepo();
    docsOnly.commit(BASE, "base");
    const docs = docsOnly.commit({ "docs/readme.md": "docs v2\n" }, "L1: docs only");
    const docsWorld = newWorld(docsOnly.cwd);
    const d = await assess(docsWorld, [landingOf(docsOnly.cwd, docs)]);
    expect(d.rows[0]).toMatchObject({ verdict: "na" });
    expect(d.rows[0]?.detail).toContain("no test reaches this plan's changes");
    expect(dimensionOf(d.rows).verdict).toBe("na");
    expect(dimensionOf(d.rows).reason).toContain("no test reaches this plan's changes");
    expect(docsWorld.invocations).toEqual([]);

    const orphanOnly = createRepo();
    orphanOnly.commit(BASE, "base");
    const orphan = orphanOnly.commit({ "packages/x/src/orphan.ts": GOOD("orphan2") }, "L1: a source no test imports");
    const orphanWorld = newWorld(orphanOnly.cwd);
    const o = await assess(orphanWorld, [landingOf(orphanOnly.cwd, orphan)]);
    expect(o.rows[0]).toMatchObject({ verdict: "na" });
    expect(o.rows[0]?.detail).toContain("no test reaches this plan's changes");
    // false green guarded: an empty selection reported as pass fails
    expect(dimensionOf(o.rows).verdict).not.toBe("pass");
    expect(orphanWorld.invocations).toEqual([]);
  });

  it("AC-SC-4 a changed source with no consumer test next to one that has one does not by itself make regression not measured", async () => {
    const repo = createRepo();
    repo.commit(BASE, "base");
    const l1 = repo.commit({ "packages/x/src/orphan.ts": GOOD("orphan2"), "packages/x/src/a.ts": GOOD("a2") }, "L1: touch an orphan source and a");
    const world = newWorld(repo.cwd);
    const r = await assess(world, [landingOf(repo.cwd, l1)]);
    expect(filesRun(world)).toEqual([A_TEST]);
    expect(r.rows.some((x) => x.verdict === "not-measured")).toBe(false);
    expect(dimensionOf(r.rows).verdict).toBe("pass");
  });
});
